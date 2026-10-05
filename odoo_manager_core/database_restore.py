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
from datetime import UTC, datetime

DUMP_MEMBER = "dump.sql"
FILESTORE_PREFIX = "filestore/"
CHUNK_BYTES = 1024 * 1024
MIB = 1024 * 1024
GIB = 1024 * MIB

# pg_dump écrit les extensions en tête de fichier, avant la première table.
EXTENSION_STATEMENT_RE = re.compile(
    rb'^CREATE EXTENSION IF NOT EXISTS "?(?P<name>[A-Za-z_][A-Za-z0-9_]*)"?', re.MULTILINE
)
# Seul le propriétaire de l'extension peut la commenter : la ligne échouerait à chaque restauration.
EXTENSION_COMMENT_RE = re.compile(rb"^COMMENT ON EXTENSION [^\n]*\n", re.MULTILINE)
PROLOGUE_END_RE = re.compile(rb"^(?:CREATE TABLE|COPY) ", re.MULTILINE)
PROLOGUE_MAX_BYTES = 8 * MIB
# Après les données viennent les clés, les index et les contraintes : peu d'octets, mais la plus
# longue partie de la restauration d'une grosse base.
POST_DATA_RE = re.compile(rb"^(?:CREATE (?:UNIQUE )?INDEX|ALTER TABLE ONLY \S+\s+ADD CONSTRAINT) ", re.MULTILINE)

# Extensions qu'Odoo crée lui-même dans chaque nouvelle base (service/db.py, _create_empty_database).
ODOO_BASE_EXTENSIONS = ("pg_trgm", "unaccent")

# Une base chargée occupe en général 50 à 70 % de son dump texte ; le journal des transactions
# demande en plus quelques Go pendant le chargement.
DATABASE_TO_DUMP_RATIO = 0.7
DATABASE_SPACE_MARGIN_BYTES = 2 * GIB
FILESTORE_SPACE_MARGIN_BYTES = 512 * MIB

# Valeurs qu'Odoo régénère pour une copie (ir.config_parameter.init(force=True) à la restauration) :
# une copie ne doit pas partager l'identité de la base d'origine auprès des services Odoo.
NEUTRALIZATION_SAFETY_SQL = """
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

    Retourne (prologue nettoyé, octets déjà lus après le prologue, extensions demandées). Sans table
    dans les `max_bytes` premiers octets, tout ce qui a été lu est rendu tel quel, sans extension.
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
            extensions = []
            for found in EXTENSION_STATEMENT_RE.finditer(prologue):
                name = found.group("name").decode("ascii")
                if name not in extensions:
                    extensions.append(name)
            return EXTENSION_COMMENT_RE.sub(b"", prologue), rest, extensions
    return b"", buffer, []


def restore_session_options(server_version_num, memory_bytes=0, cpus=0):
    """Options de la session psql qui charge le dump (variable PGOPTIONS).

    Plus de mémoire pour construire les index (l'étape la plus longue), validations sans attendre
    l'écriture sur disque (un arrêt brutal ne perd que les dernières secondes, sans corrompre la
    base) et, depuis PostgreSQL 11, plusieurs processus par index.
    """
    budget = memory_bytes // 8 if memory_bytes else 256 * MIB
    maintenance_mib = max(128, min(2047, budget // MIB))
    options = [
        ("maintenance_work_mem", f"{maintenance_mib}MB"),
        ("synchronous_commit", "off"),
        # Les NOTICE (« extension already exists »…) noieraient les vraies erreurs.
        ("client_min_messages", "warning"),
    ]
    if server_version_num >= 110000 and cpus >= 2:
        options.append(("max_parallel_maintenance_workers", str(min(4, cpus // 2))))
    return " ".join(f"-c {name}={value}" for name, value in options)


def copy_parameters_sql(now=None, database_uuid=None, database_secret=None):
    """SQL qui donne à la base restaurée l'identité d'une copie, comme le fait Odoo."""
    now = now or datetime.now(UTC).replace(tzinfo=None)
    values = {
        "database.secret": str(database_secret or uuid.uuid4()),
        "database.uuid": str(database_uuid or uuid.uuid1()),
        "database.create_date": now.strftime("%Y-%m-%d %H:%M:%S"),
        "web.base.url": "http://localhost:8069",
        "base.login_cooldown_after": "10",
        "base.login_cooldown_duration": "60",
    }
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
    """Extensions PostgreSQL que le dump crée, lues dans ses premiers Mo."""
    with archive.open(entry) as source:
        return split_prologue(source.read)[2]


def stream_dump(archive, entry, write, progress, read_size=CHUNK_BYTES):
    """Envoie dump.sql à `write` sans le décompresser sur disque."""
    with archive.open(entry) as source:
        prologue, rest, _extensions = split_prologue(source.read)
        for chunk in (prologue, rest):
            if chunk:
                write(chunk)
                progress.feed(chunk)
        while True:
            chunk = source.read(read_size)
            if not chunk:
                break
            write(chunk)
            progress.feed(chunk)


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
