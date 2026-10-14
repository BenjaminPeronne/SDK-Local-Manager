"""Restauration d'une sauvegarde Odoo directement dans PostgreSQL, sans passer par Odoo.

Odoo restaure une sauvegarde pendant une requête HTTP : il recopie l'archive dans le /tmp du
conteneur, y décompresse dump.sql (31 Go pour une archive de 4 Go), lance psql, puis charge le code
de tous les modules de la base. Au-delà de limit_time_real (20 min dans le modèle des projets), le
serveur se relance lui-même au milieu de l'opération ; un paquet Python manquant la fait échouer à la
toute fin, et les fichiers temporaires restent dans le conteneur.

Ici, dump.sql est lu dans le ZIP et transmis au fil de l'eau à psql dans le conteneur PostgreSQL :
rien n'est décompressé sur le disque, aucune limite de durée ne s'applique et le code des modules
n'intervient pas. Le filestore suit le même chemin, en archive tar vers le conteneur Odoo.

Fonctions pures : le backend leur passe l'archive ouverte et les flux des processus qu'il a lancés.
"""

import re
import tarfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

DUMP_MEMBER = "dump.sql"
FILESTORE_PREFIX = "filestore/"
CHUNK_BYTES = 1024 * 1024
MIB = 1024 * 1024
GIB = 1024 * MIB

# pg_dump écrit les extensions en tête de fichier, avant la première table.
EXTENSION_STATEMENT_RE = re.compile(
    rb'^CREATE EXTENSION IF NOT EXISTS "?(?P<name>[A-Za-z_][A-Za-z0-9_]*)"?'
    rb'(?: WITH SCHEMA "?(?P<schema>[A-Za-z_][A-Za-z0-9_]*)"?)?',
    re.MULTILINE,
)
# Odoo.sh range unaccent dans son propre schéma, créé par le dump : l'extension y est créée avant.
SCHEMA_STATEMENT_RE = re.compile(rb"^CREATE SCHEMA (?!IF NOT EXISTS )", re.MULTILINE)
# Seul le propriétaire de l'extension peut la commenter : la ligne échouerait à chaque restauration.
EXTENSION_COMMENT_RE = re.compile(rb"^COMMENT ON EXTENSION [^\n]*\n", re.MULTILINE)
PROLOGUE_END_RE = re.compile(rb"^(?:CREATE TABLE|COPY) ", re.MULTILINE)
PROLOGUE_MAX_BYTES = 8 * MIB
# Après les données viennent les clés, les index et les contraintes : peu d'octets, mais la plus
# longue partie de la restauration d'une grosse base.
POST_DATA_RE = re.compile(rb"^(?:CREATE (?:UNIQUE )?INDEX|ALTER TABLE ONLY \S+\s+ADD CONSTRAINT) ", re.MULTILINE)
COPY_START_RE = re.compile(rb"^COPY (?P<table>\S+) [^\n]* FROM stdin;\n", re.MULTILINE)
COPY_END = b"\n\\.\n"
# COPY FREEZE est refusé sur une table partitionnée (dump fait avec --load-via-partition-root).
PARTITIONED_TABLE_RE = re.compile(rb"\bPARTITION (?:BY|OF)\b")
# Au-delà, le post-data n'est pas celui d'une base Odoo ordinaire : il part tel quel vers psql.
POST_DATA_MAX_BYTES = 64 * MIB
# Réglages de session de l'en-tête du dump (search_path vide…) : chaque session du post-data les rejoue.
SESSION_SETTING_RE = re.compile(rb"^(?:SET \w+ = [^\n]*;|SELECT pg_catalog\.set_config\([^\n]*\);)$", re.MULTILINE)

# Instructions d'un script pg_dump : chaînes, identifiants entre guillemets, corps $$…$$ et
# commentaires peuvent contenir un point-virgule qui ne termine rien.
SQL_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_])[Ee]'(?:[^'\\]|\\.|'')*'"
    r"|'(?:[^']|'')*'"
    r'|"(?:[^"]|"")*"'
    r"|\$\$.*?\$\$"
    r"|\$(?P<tag>[A-Za-z_][A-Za-z0-9_]*)\$.*?\$(?P=tag)\$"
    r"|--[^\n]*"
    r"|/\*.*?\*/"
    r"|;"
    r"|^\\[^\n]*",
    re.DOTALL | re.MULTILINE,
)
LEADING_COMMENTS_RE = re.compile(r"\A(?:\s+|--[^\n]*)*")
INDEX_SQL_RE = re.compile(r"\ACREATE (?:UNIQUE )?INDEX (?P<name>\S+) ON (?:ONLY )?(?P<table>\S+) ")
CONSTRAINT_SQL_RE = re.compile(
    r"\AALTER TABLE (?P<only>ONLY )?(?P<table>\S+)\s+ADD CONSTRAINT (?P<name>\S+) "
    r"(?P<kind>FOREIGN KEY|PRIMARY KEY|UNIQUE|CHECK|EXCLUDE)\b"
)
# pg_dump range chaque commentaire juste après son objet : il suit la table de cet objet.
CONSTRAINT_COMMENT_SQL_RE = re.compile(r"\ACOMMENT ON CONSTRAINT (?P<name>\S+) ON (?P<table>\S+) IS ")
INDEX_COMMENT_SQL_RE = re.compile(r"\ACOMMENT ON INDEX (?P<name>\S+) IS ")

# Extensions qu'Odoo crée lui-même dans chaque nouvelle base (service/db.py, _create_empty_database).
ODOO_BASE_EXTENSIONS = ("pg_trgm", "unaccent")

# Une base chargée occupe en général 50 à 70 % de son dump texte ; le journal des transactions
# demande en plus quelques Go pendant le chargement.
DATABASE_TO_DUMP_RATIO = 0.7
DATABASE_SPACE_MARGIN_BYTES = 2 * GIB
FILESTORE_SPACE_MARGIN_BYTES = 512 * MIB

# Synchronisation bancaire : une copie qui garde les accès de la production interroge la vraie banque,
# et un jeton renouvelé dans la copie seulement peut bloquer la synchronisation de la production.
# Odoo 16 et suivants coupent le lien Odoo Fin eux-mêmes (account_online_synchronization/data/
# neutralize.sql) ; Odoo 12 à 15 et les modules OCA account_statement_import_online* jamais.
BANK_SYNC_SECRETS = (
    ("account_online_link", "provider_data"),
    # Odoo 12 : account_ponto et account_yodlee.
    ("account_online_provider", "ponto_token"),
    ("res_company", "yodlee_user_password"),
    ("res_company", "yodlee_access_token"),
    ("res_company", "yodlee_user_access_token"),
    # OCA : mot de passe ou clé d'API selon le service, puis les jetons propres à chacun.
    ("online_bank_statement_provider", "password"),
    ("online_bank_statement_provider", "key"),
    ("online_bank_statement_provider", "passphrase"),
    ("online_bank_statement_provider", "certificate_private_key"),
    ("online_bank_statement_provider", "ponto_token"),
    ("online_bank_statement_provider", "gocardless_token"),
    ("online_bank_statement_provider", "gocardless_refresh_token"),
    ("online_bank_statement_provider", "plaid_access_token"),
)

BANK_SYNC_NEUTRALIZATION_SQL = f"""
DO $$
DECLARE
    secret record;
BEGIN
    IF to_regclass('public.account_online_link') IS NOT NULL THEN
        -- Comme Odoo : le serveur Odoo Fin refuse toute demande signée par ce lien.
        EXECUTE 'UPDATE account_online_link SET client_id = ''duplicate'' WHERE client_id IS DISTINCT FROM ''duplicate''';
    END IF;
    IF to_regclass('public.online_bank_statement_provider') IS NOT NULL THEN
        EXECUTE 'UPDATE online_bank_statement_provider SET active = false WHERE active';
    END IF;
    FOR secret IN
        SELECT c.relname::text AS table_name, a.attname::text AS column_name
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
         WHERE c.relnamespace = 'public'::regnamespace
           AND a.attnum > 0
           AND NOT a.attisdropped
           AND (c.relname::text, a.attname::text) IN (VALUES {", ".join(f"('{table}', '{column}')" for table, column in BANK_SYNC_SECRETS)})
    LOOP
        EXECUTE format('UPDATE %I SET %I = NULL WHERE %I IS NOT NULL', secret.table_name, secret.column_name, secret.column_name);
    END LOOP;
END
$$;
""".strip()

# Valeurs qu'Odoo régénère pour une copie (ir.config_parameter.init(force=True) à la restauration) :
# une copie ne doit pas partager l'identité de la base d'origine auprès des services Odoo.
NEUTRALIZATION_SAFETY_SQL = (
    """
UPDATE ir_cron SET active = false
 WHERE active
   AND id NOT IN (
       SELECT res_id FROM ir_model_data
        WHERE model = 'ir.cron' AND module = 'base' AND name = 'autovacuum_job'
   );
UPDATE ir_mail_server SET active = false WHERE active;
DO $$
BEGIN
    IF to_regclass('public.fetchmail_server') IS NOT NULL THEN
        EXECUTE 'UPDATE fetchmail_server SET active = false WHERE active';
    END IF;
END
$$;
"""
    + BANK_SYNC_NEUTRALIZATION_SQL
).strip()

PARTITIONED_TABLES_SQL = "SELECT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'p');"

# Taille de chaque table, sous le nom que lui donne pg_dump (public.res_partner) : poids des tâches du post-data.
TABLE_SIZES_SQL = """
SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) || '|' || pg_relation_size(c.oid)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'm', 'p')
   AND n.nspname NOT IN ('pg_catalog', 'information_schema');
""".strip()

INSTALLED_MODULES_SQL = (
    "SELECT name FROM ir_module_module WHERE state IN ('installed', 'to upgrade', 'to install') ORDER BY name;"
)


def backup_contents(archive):
    """Taille décompressée de dump.sql et entrées du filestore d'une archive Odoo ouverte."""
    dump = None
    filestore = []
    for entry in archive.infolist():
        name = entry.filename.replace("\\", "/")
        if name == DUMP_MEMBER:
            dump = entry
        elif name.startswith(FILESTORE_PREFIX) and not entry.is_dir() and name[len(FILESTORE_PREFIX) :]:
            filestore.append(entry)
    if dump is None:
        raise ValueError("Archive Odoo invalide: le fichier dump.sql est absent.")
    return dump, filestore


def space_needed(dump_bytes, filestore_bytes=0):
    """(octets pour PostgreSQL, octets pour le filestore) avant de lancer la restauration."""
    database = int(dump_bytes * DATABASE_TO_DUMP_RATIO) + DATABASE_SPACE_MARGIN_BYTES
    files = filestore_bytes + FILESTORE_SPACE_MARGIN_BYTES if filestore_bytes else 0
    return database, files


def parse_df_available(output):
    """Octets disponibles d'après `df -Pk <chemin>`, ou None si la sortie est illisible."""
    lines = [line for line in str(output or "").splitlines() if line.strip()]
    if len(lines) < 2:
        return None
    columns = lines[-1].split()
    if len(columns) < 4 or not columns[3].isdigit():
        return None
    return int(columns[3]) * 1024


def format_bytes(value):
    if value >= GIB:
        return f"{value / GIB:.1f} Go".replace(".", ",")
    return f"{max(value, 0) / MIB:.0f} Mo"


def split_prologue(read, max_bytes=PROLOGUE_MAX_BYTES, chunk_size=CHUNK_BYTES):
    """Lit le début du dump jusqu'à la première table.

    Retourne (prologue nettoyé, octets déjà lus après le prologue, extensions demandées avec leur
    schéma, vide pour celui par défaut). Sans table dans les `max_bytes` premiers octets, tout ce
    qui a été lu est rendu tel quel, sans extension.
    """
    buffer = b""
    while len(buffer) < max_bytes:
        chunk = read(chunk_size)
        if not chunk:
            break
        buffer += chunk
        match = PROLOGUE_END_RE.search(buffer)
        if match:
            prologue, rest = buffer[: match.start()], buffer[match.start() :]
            extensions = {}
            for found in EXTENSION_STATEMENT_RE.finditer(prologue):
                schema = (found.group("schema") or b"").decode("ascii")
                extensions.setdefault(found.group("name").decode("ascii"), "" if schema == "public" else schema)
            prologue = SCHEMA_STATEMENT_RE.sub(b"CREATE SCHEMA IF NOT EXISTS ", EXTENSION_COMMENT_RE.sub(b"", prologue))
            return prologue, rest, extensions
    return b"", buffer, {}


def restore_session_options(server_version_num, memory_bytes=0, cpus=0, sessions=1):
    """Options d'une session psql de la restauration (variable PGOPTIONS).

    Plus de mémoire pour construire les index (l'étape la plus longue), validations sans attendre
    l'écriture sur disque (un arrêt brutal ne perd que les dernières secondes, sans corrompre la
    base) et, depuis PostgreSQL 11, plusieurs processus par index. Mémoire et processus sont
    partagés entre les `sessions` qui construisent les index en même temps.
    """
    sessions = max(int(sessions or 1), 1)
    budget = (memory_bytes // 8 if memory_bytes else 256 * MIB) // sessions
    maintenance_mib = max(64 if sessions > 1 else 128, min(2047, budget // MIB))
    options = [
        ("maintenance_work_mem", f"{maintenance_mib}MB"),
        ("synchronous_commit", "off"),
        # Les NOTICE (« extension already exists »…) noieraient les vraies erreurs.
        ("client_min_messages", "warning"),
    ]
    if server_version_num >= 110000 and cpus >= 2:
        options.append(("max_parallel_maintenance_workers", str(min(4, cpus // 2) // sessions)))
    return " ".join(f"-c {name}={value}" for name, value in options)


def post_data_sessions(cpus, shared_folder=False):
    """Sessions PostgreSQL qui construisent index et contraintes en même temps.

    Sur un disque rapide (Linux, WSL), trois sessions gagnent encore 15 à 30 % sur une base de
    quelques Go. Sous macOS, les données de PostgreSQL passent par le partage de fichiers de Docker
    Desktop : le disque limite déjà une session seule, et plusieurs à la fois vont moins vite.
    """
    if shared_folder:
        return 1
    return max(1, min(3, int(cpus or 0) // 2))


def parameters_sql(values):
    """SQL qui écrit chaque paramètre système (ir_config_parameter), créé s'il manque."""
    statements = []
    for key, value in values.items():
        key_literal = sql_literal(key)
        value_literal = sql_literal(value)
        statements.append(
            f"UPDATE ir_config_parameter SET value = {value_literal}, write_uid = 1, "
            f"write_date = now() AT TIME ZONE 'UTC' WHERE key = {key_literal};"
        )
        statements.append(
            "INSERT INTO ir_config_parameter (key, value, create_uid, create_date, write_uid, write_date) "
            f"SELECT {key_literal}, {value_literal}, 1, now() AT TIME ZONE 'UTC', 1, now() AT TIME ZONE 'UTC' "
            f"WHERE NOT EXISTS (SELECT 1 FROM ir_config_parameter WHERE key = {key_literal});"
        )
    return "\n".join(statements)


def copy_parameters_sql(now=None, database_uuid=None, database_secret=None):
    """SQL qui donne à la base restaurée l'identité d'une copie, comme le fait Odoo."""
    now = now or datetime.now(UTC).replace(tzinfo=None)
    return parameters_sql(
        {
            "database.secret": str(database_secret or uuid.uuid4()),
            "database.uuid": str(database_uuid or uuid.uuid1()),
            "database.create_date": now.strftime("%Y-%m-%d %H:%M:%S"),
            "base.login_cooldown_after": "10",
            "base.login_cooldown_duration": "60",
        }
    )


# Adresse par défaut d'Odoo, injoignable ici : les projets ne sont servis que par Traefik.
ODOO_DEFAULT_BASE_URLS = ("http://localhost:8069", "http://127.0.0.1:8069")
# Dans son conteneur, Odoo écoute sur 8069 : wkhtmltopdf y lit les styles des rapports PDF.
LOCAL_REPORT_URL = "http://127.0.0.1:8069"
LOCAL_REPORT_URL_RE = r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/?$"


def restored_urls_sql(base_url):
    """SQL qui fait pointer les liens d'une base restaurée vers ce poste.

    web.base.url sert aux liens des e-mails (invitation au portail, réinitialisation du mot de
    passe…) : celle de la production ou http://localhost:8069 mènent ailleurs ou nulle part.
    report.url, s'il existe, vise le serveur de production : les PDF perdraient leur mise en page.
    """
    return (
        parameters_sql({"web.base.url": base_url})
        + "\n"
        + f"UPDATE ir_config_parameter SET value = {sql_literal(LOCAL_REPORT_URL)}, write_uid = 1, "
        "write_date = now() AT TIME ZONE 'UTC' WHERE key = 'report.url';"
    )


def local_urls_sql(base_url):
    """SQL qui corrige, dans la base courante, les adresses injoignables depuis ce poste.

    Ne touche que l'adresse par défaut d'Odoo ou une ancienne adresse du projet (port de Traefik
    changé) pour web.base.url, et une adresse locale sur un autre port qu'Odoo pour report.url :
    une adresse choisie à la main (tunnel vers un téléphone…) est gardée. Sans effet sur une base
    qui n'est pas une base Odoo ; renvoie une ligne « base|paramètre » par valeur corrigée.
    """
    host = re.match(r"^https?://([^/:]+)", base_url)
    host_pattern = "^https?://" + re.escape(host.group(1) if host else base_url) + "(:[0-9]+)?/?$"
    defaults = ", ".join(sql_literal(url + suffix) for url in ODOO_DEFAULT_BASE_URLS for suffix in ("", "/"))
    url = sql_literal(base_url)
    report_url = sql_literal(LOCAL_REPORT_URL)
    return f"""CREATE TEMP TABLE sdk_local_urls (key text);
DO $sdk$
BEGIN
  IF to_regclass('public.ir_config_parameter') IS NULL THEN
    RETURN;
  END IF;
  WITH changed AS (
    UPDATE ir_config_parameter SET value = {url}, write_uid = 1, write_date = now() AT TIME ZONE 'UTC'
    WHERE key = 'web.base.url' AND value <> {url}
      AND (value IN ({defaults}) OR value ~* {sql_literal(host_pattern)})
    RETURNING key
  )
  INSERT INTO sdk_local_urls SELECT key FROM changed;
  WITH changed AS (
    UPDATE ir_config_parameter SET value = {report_url}, write_uid = 1, write_date = now() AT TIME ZONE 'UTC'
    WHERE key = 'report.url' AND value ~* {sql_literal(LOCAL_REPORT_URL_RE)} AND value !~ ':8069/?$'
    RETURNING key
  )
  INSERT INTO sdk_local_urls SELECT key FROM changed;
END
$sdk$;
SELECT current_database() || '|' || key FROM sdk_local_urls ORDER BY key;"""


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def sql_identifier(value):
    return '"' + str(value).replace('"', '""') + '"'


def create_database_sql(db_name, owner):
    """Même base vide qu'Odoo : encodage unicode et tri « C », plus rapide pour les index."""
    return (
        f"CREATE DATABASE {sql_identifier(db_name)} OWNER {sql_identifier(owner)} "
        "ENCODING 'unicode' LC_COLLATE 'C' TEMPLATE template0;"
    )


class DumpProgress:
    """Suit les octets envoyés à psql et repère le début des index (fin des données)."""

    def __init__(self, total, on_progress=None, on_post_data=None, step_percent=5):
        self.total = max(int(total), 0)
        self.sent = 0
        self.post_data = False
        self._on_progress = on_progress
        self._on_post_data = on_post_data
        self._step = step_percent
        self._next = step_percent

    def feed(self, chunk):
        self.sent += len(chunk)
        if not self.post_data and POST_DATA_RE.search(chunk):
            self.post_data = True
            if self._on_post_data:
                self._on_post_data()
        if self._on_progress:
            percent = int(self.sent * 100 / self.total) if self.total else 100
            self._on_progress(self.sent, self.total, percent if percent >= self._next else None)
            if percent >= self._next:
                self._next = (percent // self._step + 1) * self._step


def dump_extensions(archive, entry):
    """Extensions PostgreSQL que le dump crée, lues dans ses premiers Mo : {nom: schéma ou ""}."""
    with archive.open(entry) as source:
        return split_prologue(source.read)[2]


def stream_dump(archive, entry, write, progress, read_size=CHUNK_BYTES, splitter=None):
    """Envoie dump.sql à `write` sans le décompresser sur disque.

    Avec `splitter` (DumpSplitter), le post-data n'est pas envoyé : il reste dans le splitter.
    """
    with archive.open(entry) as source:
        prologue, rest, _extensions = split_prologue(source.read)
        if splitter:
            splitter.session_settings = SESSION_SETTING_RE.findall(prologue)
        chunks = [prologue, rest]
        while True:
            chunk = chunks.pop(0) if chunks else source.read(read_size)
            if not chunk:
                if chunks:
                    continue
                break
            data = splitter.feed(chunk) if splitter else chunk
            if data:
                write(data)
            progress.feed(chunk)
        if splitter:
            data = splitter.finish()
            if data:
                write(data)


class DumpSplitter:
    """Sépare au fil de l'eau le post-data (clés, index, contraintes) du reste du dump.

    Le début du post-data n'est cherché qu'en dehors des blocs COPY : une ligne de données ne peut
    pas être prise pour une instruction. Un post-data démesuré repart vers psql avec le reste.

    Avec `freeze`, chaque table est chargée déjà figée (COPY FREEZE, après un TRUNCATE de la table
    vide dans la même transaction) : sans cela, PostgreSQL réécrit chacune de ses pages à leur
    première lecture, celle de la construction du premier index.
    """

    # Une ligne COPY d'une table très large dépasse le Mo ; une marge de 64 Ko suffit à toutes les autres.
    LOOKBACK = 64 * 1024

    def __init__(self, max_post_data=POST_DATA_MAX_BYTES, freeze=False):
        self.max_post_data = max_post_data
        self.freeze = freeze
        self.session_settings = []
        self.post_data = None
        self._in_copy = False
        self._frozen_copy = False
        self._pending = b""
        self._passthrough = False

    def feed(self, chunk):
        """Retourne ce qui peut partir vers psql maintenant."""
        if self._passthrough:
            return chunk
        if self.post_data is not None:
            self.post_data += chunk
            if len(self.post_data) > self.max_post_data:
                self._passthrough = True
                data, self.post_data = bytes(self.post_data), None
                return data
            return b""
        buffer = self._pending + chunk
        output = []
        while buffer:
            if self._in_copy:
                end = buffer.find(COPY_END)
                if end < 0:
                    keep = len(COPY_END) - 1
                    output.append(buffer[:-keep])
                    buffer = buffer[-keep:]
                    break
                output.append(buffer[: end + len(COPY_END)])
                if self._frozen_copy:
                    output.append(b"COMMIT;\n")
                buffer = buffer[end + len(COPY_END) :]
                self._in_copy = self._frozen_copy = False
                continue
            copy = COPY_START_RE.search(buffer)
            statements_end = copy.start() if copy else len(buffer)
            if self.freeze and PARTITIONED_TABLE_RE.search(buffer, 0, statements_end):
                self.freeze = False
            post = POST_DATA_RE.search(buffer, 0, statements_end)
            if post and (not copy or post.start() < copy.start()):
                output.append(buffer[: post.start()])
                self.post_data = bytearray(buffer[post.start() :])
                buffer = b""
                break
            if copy:
                output.append(buffer[: copy.start()])
                header = buffer[copy.start() : copy.end() - 1]
                if self.freeze:
                    # Une erreur annule la transaction : COMMIT vaut alors ROLLBACK, comme une COPY ratée.
                    table = copy["table"]
                    header = header.removesuffix(b" FROM stdin;") + b" FROM stdin WITH (FREEZE);"
                    output.append(b"BEGIN;\nTRUNCATE ONLY " + table + b";\n")
                    self._frozen_copy = True
                # Le saut de ligne de l'en-tête reste : une table vide se termine aussitôt par « \n\.\n ».
                output.append(header)
                buffer = buffer[copy.end() - 1 :]
                self._in_copy = True
                continue
            cut = buffer.rfind(b"\n", 0, max(len(buffer) - self.LOOKBACK, 0)) + 1
            output.append(buffer[:cut])
            buffer = buffer[cut:]
            break
        self._pending = buffer
        return b"".join(output)

    def finish(self):
        data, self._pending = self._pending, b""
        return data


def split_sql_statements(text):
    """Instructions d'un script SQL, sans les commentaires qui les précèdent ni leur point-virgule.

    Une méta-commande psql (`\\unrestrict` de pg_dump…) est rendue telle quelle, sur sa ligne.
    """
    statements = []
    start = 0
    for match in SQL_TOKEN_RE.finditer(text):
        token = match.group()
        if token != ";" and not token.startswith("\\"):
            continue
        body = LEADING_COMMENTS_RE.sub("", text[start : match.start()], count=1)
        if token.startswith("\\"):
            if body:
                # Barre oblique au milieu d'une instruction : psql la lit comme une méta-commande,
                # mais pg_dump n'en écrit jamais là. L'instruction garde son texte.
                continue
            body = token.rstrip()
        if body:
            statements.append(body)
        start = match.end()
    tail = LEADING_COMMENTS_RE.sub("", text[start:], count=1).rstrip()
    if tail:
        statements.append(tail)
    return statements


@dataclass
class PostDataTask:
    """Instructions exécutées à la suite dans une même session ; `table` en donne le poids."""

    statements: list
    table: str = ""
    weight: int = 1

    @property
    def script(self):
        return "".join(statement + ";\n" for statement in self.statements)


@dataclass
class PostDataStep:
    tasks: list
    parallel: bool = False


def post_data_steps(statements):
    """Étapes du post-data, dans l'ordre de pg_dump.

    Clés primaires, index et contraintes d'une table forment une tâche ; les tables différentes
    avancent en parallèle (chaque instruction ne verrouille qu'une table : pas d'interblocage
    possible). Une clé étrangère verrouille aussi la table qu'elle désigne, et presque toutes
    désignent res_users : elles sont donc créées sans contrôle (NOT VALID), puis contrôlées
    table par table en parallèle, ce contrôle ne bloquant pas la table désignée. Le résultat est
    identique à une création directe. Le reste garde son ordre, seul.
    """
    steps = []
    group_kind = None
    group = []
    tables = {}

    def close():
        if not group:
            return
        if group_kind == "build":
            steps.append(PostDataStep(tasks_by_table(group), parallel=True))
        elif group_kind == "foreign key":
            created = [statement + " NOT VALID" if validation else statement for _table, statement, validation in group]
            steps.append(PostDataStep([PostDataTask(created)]))
            validations = [(table, validation) for table, _statement, validation in group if validation]
            steps.append(PostDataStep(tasks_by_table(validations), parallel=True))
        else:
            steps.append(PostDataStep([PostDataTask([statement for _table, statement, _validation in group])]))
        group.clear()

    for statement in statements:
        if statement.startswith("\\"):
            # \restrict et \unrestrict ne valent que pour la session qui a lu le début du dump.
            continue
        kind, table, validation = "other", "", ""
        index = INDEX_SQL_RE.match(statement)
        constraint = CONSTRAINT_SQL_RE.match(statement)
        comment = CONSTRAINT_COMMENT_SQL_RE.match(statement) or INDEX_COMMENT_SQL_RE.match(statement)
        if index:
            kind, table = "build", index["table"]
            schema = table.rpartition(".")[0]
            tables[f"{schema}.{index['name']}" if schema else index["name"]] = (kind, table)
        elif constraint and constraint["kind"] != "FOREIGN KEY":
            kind, table = "build", constraint["table"]
            tables[(constraint["name"], table)] = (kind, table)
        elif constraint:
            kind, table = "foreign key", constraint["table"]
            # Une clé étrangère déjà NOT VALID dans la base d'origine le reste.
            if not statement.endswith("NOT VALID"):
                validation = f"ALTER TABLE {constraint['only'] or ''}{table} VALIDATE CONSTRAINT {constraint['name']}"
            tables[(constraint["name"], table)] = (kind, table)
        elif comment:
            key = (comment["name"], comment["table"]) if "table" in comment.groupdict() else comment["name"]
            kind, table = tables.get(key, ("other", ""))
        if kind != group_kind:
            close()
            group_kind = kind
        group.append((table, statement, validation))
    close()
    return steps


def tasks_by_table(items):
    tasks = {}
    for table, statement, *_rest in items:
        tasks.setdefault(table, PostDataTask([], table=table)).statements.append(statement)
    return list(tasks.values())


def ordered_post_data_tasks(statements):
    """Post-data dans l'ordre du dump, en tâches successives : les instructions voisines d'une même table."""
    tasks = []
    for statement in statements:
        if statement.startswith("\\"):
            continue
        match = INDEX_SQL_RE.match(statement) or CONSTRAINT_SQL_RE.match(statement)
        table = match["table"] if match else ""
        if not tasks or tasks[-1].table != table:
            tasks.append(PostDataTask([], table=table))
        tasks[-1].statements.append(statement)
    return tasks


def write_filestore_tar(archive, entries, output, on_file=None):
    """Écrit le filestore de l'archive en flux tar (chemins relatifs à filestore/<base>)."""
    with tarfile.open(fileobj=output, mode="w|", format=tarfile.PAX_FORMAT) as tar:
        for index, entry in enumerate(entries, start=1):
            relative = entry.filename.replace("\\", "/")[len(FILESTORE_PREFIX) :]
            parts = [part for part in relative.split("/") if part]
            if not parts or any(part in {".", ".."} for part in parts):
                raise ValueError(f"Archive Odoo invalide: chemin de filestore dangereux ({entry.filename}).")
            info = tarfile.TarInfo("/".join(parts))
            info.size = entry.file_size
            info.mode = 0o644
            info.mtime = int(datetime(*entry.date_time).timestamp()) if entry.date_time[0] >= 1980 else 0
            with archive.open(entry) as source:
                tar.addfile(info, source)
            if on_file:
                on_file(index, len(entries))


class PsqlErrors:
    """Erreurs remontées par psql pendant le chargement, gardées en nombre limité pour le journal.

    Odoo ignore lui aussi ces erreurs (psql sans ON_ERROR_STOP) : une instruction refusée n'arrête
    pas le chargement. Elles sont comptées et montrées pour qu'une base incomplète ne passe pas
    inaperçue.
    """

    LIMIT = 15

    def __init__(self, log=None):
        self.count = 0
        self.lines = []
        self._log = log

    def add(self, line):
        line = line.strip()
        if not line:
            return
        if re.search(r"\b(?:ERROR|FATAL|ERREUR)\b", line):
            self.count += 1
            if self.count > self.LIMIT:
                return
        elif not self.lines or self.count > self.LIMIT:
            # Lignes de détail (LINE, HINT…) : seulement sous une erreur affichée.
            return
        self.lines.append(line)
        if self._log:
            self._log(f"psql : {line[:400]}")
