import http.client
import os
import platform
import re
import shlex
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import uuid
from pathlib import Path

from . import data_conflicts, database_restore, job_progress, jobs, performance
from .command_output import missing_python_import, python_package_for_import
from .platform import (
    command_uses_wsl,
    executable_search_path,
    find_wsl_executable_distribution,
    hidden_process_kwargs,
    host_executable_available,
    resolve_host_executable,
    workspace_execution_path,
    workspace_wsl_context,
    wsl_command_prefix,
    wsl_command_with_cwd,
)
from .system import docker_command
from .traefik import (
    TRAEFIK_CONFIG_FILENAMES,
    TRAEFIK_DEFAULT_HTTP_PORT,
    TraefikInstance,
    compose_service_block,
    compose_service_container_name,
    compose_service_ports,
    detect_traefik_instances,
    entrypoints_from_config,
    same_directory,
    select_traefik_instance,
    url_with_port,
)

COMPOSE_FILENAMES = ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")
# Première page Odoo servie dans le conteneur : 2xx/3xx/4xx = serveur prêt, 5xx ou exception = pas encore.
ODOO_HTTP_READY_SCRIPT = """import http.client, sys
connection = http.client.HTTPConnection("127.0.0.1", 8069, timeout=float(sys.argv[1]))
try:
    connection.request("GET", "/web/login", headers={"User-Agent": "Odoo-Manager/readiness"})
    status = connection.getresponse().status
except Exception as exc:
    print("sans réponse : " + type(exc).__name__)
    sys.exit(2)
print("HTTP %s" % status)
sys.exit(0 if status < 500 else 1)
"""
POSTGRES_HEALTHCHECK_START_PERIOD = "120s"


def add_postgres_healthcheck_start_period(content):
    """Ajoute un start_period aux healthchecks pg_isready qui n'en ont pas.

    Sans lui, un PostgreSQL lent à démarrer (récupération après arrêt brutal, fichiers
    sur NTFS) est « unhealthy » après interval × retries (15 s dans le modèle) et Compose
    abandonne le démarrage d'Odoo : « dependency failed to start ».
    """
    lines = content.splitlines(keepends=True)
    result = []
    index = 0
    changed = False
    while index < len(lines):
        line = lines[index]
        result.append(line)
        if line.strip() != "healthcheck:":
            index += 1
            continue
        indent = len(line) - len(line.lstrip())
        block = []
        index += 1
        while index < len(lines):
            candidate = lines[index]
            if candidate.strip() and len(candidate) - len(candidate.lstrip()) <= indent:
                break
            block.append(candidate)
            index += 1
        keys = [item for item in block if item.strip() and not item.lstrip().startswith("#")]
        if (
            keys
            and any("pg_isready" in item for item in keys)
            and not any(item.lstrip().startswith("start_period:") for item in keys)
        ):
            child_indent = min(len(item) - len(item.lstrip()) for item in keys)
            last = max(
                position for position, item in enumerate(block) if item.strip() and not item.lstrip().startswith("#")
            )
            newline = "\r\n" if block[last].endswith("\r\n") else "\n"
            if not block[last].endswith(("\n", "\r")):
                block[last] += newline
            block.insert(last + 1, " " * child_indent + f"start_period: {POSTGRES_HEALTHCHECK_START_PERIOD}{newline}")
            changed = True
        result.extend(block)
    return "".join(result), changed


# Image officielle `postgres:<majeure>` des projets créés avant que le modèle ne passe à pgvector.
# L'image pgvector de même majeure est construite sur elle : le dossier de données reste lisible.
OFFICIAL_POSTGRES_IMAGE_RE = re.compile(
    r"^(?P<prefix>(?P<indent>[ \t]*)image:[ \t]*[\"']?)postgres:(?P<major>1[3-8])"
    r"(?P<suffix>[\"']?[ \t]*(?:#[^\r\n]*)?\r?)$",
    re.MULTILINE,
)
COMPOSE_KEY_RE = re.compile(r"^(?P<indent>[ \t]*)(?P<key>[\w.-]+):[ \t]*(?:#.*)?$")


def use_pgvector_postgres_image(content):
    """Passe l'unique image `postgres:<majeure>` du compose sur `pgvector/pgvector:pg<majeure>`.

    Retourne (contenu, image, service) ; image et service vides si le compose n'a pas exactement
    une image officielle sous cette forme (variante alpine ou version mineure : rien n'est touché).
    """
    matches = list(OFFICIAL_POSTGRES_IMAGE_RE.finditer(content))
    if len(matches) != 1:
        return content, "", ""
    match = matches[0]
    # Le service est la première clé moins indentée que `image:` en remontant le fichier.
    service = ""
    for line in reversed(content[: match.start()].splitlines()):
        key = COMPOSE_KEY_RE.match(line)
        if key and len(key.group("indent")) < len(match.group("indent")):
            service = key.group("key")
            break
    if not service:
        return content, "", ""
    image = f"pgvector/pgvector:pg{match.group('major')}"
    updated = content[: match.start()] + match.group("prefix") + image + match.group("suffix") + content[match.end() :]
    return updated, image, service


def remove_odoo_container_command(content, container):
    """Retire le `command:` qui fait d'Odoo le processus principal du conteneur `container`.

    Le gestionnaire lance et arrête Odoo dans un conteneur que l'image garde en vie (`/bin/bash`).
    Lancé par `command:`, Odoo ne peut plus être arrêté (restauration neutralisée, commande module)
    sans arrêter tout le conteneur, où plus rien ne peut ensuite être lancé.
    Retourne (contenu, service) ; service vide si le service Odoo n'a pas un tel `command:`.
    """

    def indent(line):
        return len(line) - len(line.lstrip())

    lines = content.splitlines(keepends=True)
    for index, line in enumerate(lines):
        header = COMPOSE_KEY_RE.match(line)
        if not header or not header.group("indent"):
            continue
        end = next(
            (
                position
                for position in range(index + 1, len(lines))
                if lines[position].strip()
                and not lines[position].lstrip().startswith("#")
                and indent(lines[position]) <= indent(line)
            ),
            len(lines),
        )
        block = range(index + 1, end)
        container_name = re.compile(rf"\s*container_name:\s*[\"']?{re.escape(container)}[\"']?\s*(#.*)?$")
        if header.group("key") != container and not any(container_name.match(lines[i]) for i in block):
            continue
        properties = [i for i in block if lines[i].strip() and not lines[i].lstrip().startswith("#")]
        level = indent(lines[properties[0]]) if properties else 0
        for start in properties:
            if indent(lines[start]) != level or not re.match(r"\s*command:(\s|$)", lines[start]):
                continue
            stop = start + 1
            while (
                stop < end
                and lines[stop].strip()
                and (indent(lines[stop]) > level or lines[stop].lstrip().startswith("-"))
            ):
                stop += 1
            text = " ".join(
                re.sub(r"(^|\s)#.*", "", re.sub(r"^\s*-\s+", "", item))
                for item in [lines[start].split("command:", 1)[1], *lines[start + 1 : stop]]
            )
            words = " ".join("".join(parts) for parts in re.findall(r"\"([^\"]*)\"|'([^']*)'|([^\s,\[\]\"']+)", text))
            if not re.match(ODOO_SERVER_PROCESS_PATTERN, words) or re.search(ODOO_NON_SERVER_PROCESS_PATTERN, words):
                return content, ""
            return "".join(lines[:start] + lines[stop:]), header.group("key")
        return content, ""
    return content, ""


HTTP_FAILURE_LABELS = {
    "refused": "connexion refusée sur le port {port}",
    "reset": "connexion coupée sur le port {port}",
    "timeout": "délai dépassé",
    "error": "connexion interrompue",
}
ODOO_STARTUP_LOG = "/home/odoo/srv/data/odoo-manager-startup.log"
ODOO_STARTUP_STATUS = "/home/odoo/srv/data/odoo-manager-startup.status"
ODOO_LOG_FILE = "/home/odoo/srv/data/odoo.log"
PENDING_MODULE_STATES_SQL = "('to install','to upgrade','to remove')"
# Nouvelle échéance d'une base expirée corrigée : Odoo n'avertit qu'à 30 jours de la date.
DATABASE_EXPIRATION_DAYS = 365
ODOO_STATE_MARKER = "odoo-manager-state:"
# Même choix que le démarrage du serveur : le script `odoo` de l'image peut échouer (patch
# LOG_ATTACHMENTS qui ne s'applique pas, « /usr/bin/env: bad interpreter » sur une copie RIKA),
# alors que l'interpréteur du venv lance odoo-bin directement.
ODOO_CLI_FUNCTION = (
    "odoo_cli() { if [ -x /home/_venv/bin/python ] && [ -f /home/odoo/srv/server/odoo/odoo-bin ]; then "
    '/home/_venv/bin/python /home/odoo/srv/server/odoo/odoo-bin "$@"; else odoo "$@"; fi; }; '
)
# Serveur Odoo : odoo-bin ou le script `odoo` de l'image, lancé directement ou par python/bash.
# Un simple chemin finissant par /odoo, `odoo shell` ou une commande module (--stop-after-init)
# n'est pas un serveur : les confondre faisait croire Odoo démarré alors qu'il ne l'était pas.
ODOO_SERVER_PROCESS_PATTERN = r"^([^ ]*/)?((python[0-9.]*|(ba|da)?sh)( +-[^ ]+)* +)?([^ ]*/)?odoo(-bin)?( |$)"
ODOO_NON_SERVER_PROCESS_PATTERN = r"--stop-after-init|--no-http|odoo(-bin)? +shell( |$)"
ODOO_SERVER_STATE_SCRIPT = (
    "if command -v ps >/dev/null 2>&1; then processes=$(ps -eo args); "
    "else processes=$(for f in /proc/[0-9]*/cmdline; do tr '\\000' ' ' <\"$f\" 2>/dev/null; echo; done); fi; "
    f"if printf '%s\\n' \"$processes\" | grep -E '{ODOO_SERVER_PROCESS_PATTERN}' "
    f"| grep -Evq -- '{ODOO_NON_SERVER_PROCESS_PATTERN}'; then echo '{ODOO_STATE_MARKER}running'; "
    f'elif [ -f {ODOO_STARTUP_STATUS} ]; then echo "{ODOO_STATE_MARKER}exited:$(head -n 1 {ODOO_STARTUP_STATUS})"; '
    f"else echo '{ODOO_STATE_MARKER}absent'; fi"
)
# Sans processus ni code de sortie, le lanceur vient de démarrer ou a été tué : délai avant de conclure.
ODOO_PROCESS_GRACE_SECONDS = 10
# Commande du processus principal du conteneur : `/init.sh` de l'image, puis la commande qu'il lance.
CONTAINER_MAIN_PROCESS_SCRIPT = "tr '\\000' ' ' </proc/1/cmdline 2>/dev/null || true"
ODOO_DATA_DIR = "/home/odoo/srv/data"
# PostgreSQL 18 range ses données sous /var/lib/postgresql/18/docker : $PGDATA suit l'image.
POSTGRES_DATA_DIR = "${PGDATA:-/var/lib/postgresql/data}"
# Restes d'une restauration lancée par Odoo puis interrompue (relance du serveur, arrêt du conteneur) :
# la copie du ZIP (`tmpXXXX`) et le dossier où dump.sql a été décompressé (`tmpXXXX/dump.sql`),
# soit plusieurs dizaines de Go qu'Odoo n'efface jamais. Rien n'est touché pendant qu'un psql
# tourne, ni ce qu'un processus garde ouvert, ni ce qui a moins de 10 minutes.
ODOO_RESTORE_LEFTOVERS_SCRIPT = r"""
for f in /proc/[0-9]*/cmdline; do tr '\000' ' ' <"$f" 2>/dev/null; echo; done \
  | grep -Eq '^([^ ]*/)?(psql|pg_restore) ' && exit 0
find /tmp -maxdepth 1 -name 'tmp*' -mmin +10 2>/dev/null | while IFS= read -r entry; do
  if [ -d "$entry" ]; then
    [ -f "$entry/dump.sql" ] || continue
  elif [ -f "$entry" ]; then
    [ "$(head -c 2 "$entry" 2>/dev/null)" = "PK" ] || continue
  else
    continue
  fi
  for fd in /proc/[0-9]*/fd/*; do
    case "$(readlink "$fd" 2>/dev/null)" in "$entry"|"$entry"/*) continue 2;; esac
  done
  size=$(du -sk "$entry" 2>/dev/null | cut -f1)
  rm -rf -- "$entry" && echo "removed ${size:-0} $entry"
done
""".strip()
# Interpréteur d'Odoo : celui du venv de l'image, sinon python3. `$0` porte le script, `$@` ses arguments.
ODOO_PYTHON_PREFIX = 'py=/home/_venv/bin/python; [ -x "$py" ] || py=python3; '
# Noms d'import (ou de distribution) introuvables pour l'interpréteur d'Odoo, un par ligne.
MISSING_PYTHON_MODULES_SCRIPT = """import importlib.util, sys
missing = []
for name in sys.argv[1:]:
    try:
        if importlib.util.find_spec(name) is not None:
            continue
    except (ImportError, ValueError):
        pass
    try:
        from importlib import metadata
        metadata.distribution(name)
        continue
    except Exception:
        pass
    missing.append(name)
print("\\n".join(missing))
"""
# Réglages écrits par ALTER SYSTEM (postgresql.auto.conf, dans le dossier des données : ils
# survivent à la recréation du conteneur).
POSTGRES_AUTO_SETTINGS_SQL = (
    "SELECT name, setting FROM pg_file_settings WHERE sourcefile LIKE '%postgresql.auto.conf' AND error IS NULL;"
)
# `docker info` inventorie conteneurs et images : relu au plus toutes les 5 minutes.
DOCKER_RESOURCES_TTL_SECONDS = 300
DOCKER_RESOURCES_CACHE = {}
DOCKER_RESOURCES_LOCK = threading.Lock()
# Échec répété du chargement d'une base au démarrage : au-delà, attendre ne changera rien.
REGISTRY_FAILURES_BEFORE_ABORT = 3
MAX_AUTOMATIC_PYTHON_INSTALLS = 3
ACTIVE_PROCESSES = set()
ACTIVE_PROCESSES_LOCK = threading.Lock()
# `ports: !override` remplace la liste au lieu de la fusionner (Compose >= 2.24.4).
COMPOSE_OVERRIDE_TAG_MIN_VERSION = (2, 24, 4)
TRAEFIK_LOOPBACK_HEADER = """# Généré par Odoo Manager.
# Traefik publie ses ports sur toutes les interfaces : les instances Odoo locales et leur
# gestionnaire de bases (sauvegarde incluse) seraient joignables depuis le réseau.
# Les ports de la machine choisis dans le compose de Traefik sont conservés.
"""
TRAEFIK_PORT_WAIT_SECONDS = 15
# Délai laissé au fournisseur Docker de Traefik pour publier une route avant de chercher une cause certaine.
TRAEFIK_ROUTE_DIAGNOSIS_SECONDS = 20


def traefik_loopback_override(service, ports):
    """Surcharge compose qui limite les ports publiés à 127.0.0.1 sans changer leurs numéros."""
    lines = [TRAEFIK_LOOPBACK_HEADER.rstrip("\n"), "services:", f"  {service}:", "    ports: !override"]
    seen = set()
    for port in ports:
        # Les publications toutes interfaces (IPv4 ou IPv6) deviennent une seule publication locale.
        host_ip = "127.0.0.1" if port.host_ip in {"", "0.0.0.0", "::", "[::]"} else port.host_ip
        entry = f"{host_ip}:{port.host_port}:{port.container_port}" + (
            "" if port.protocol == "tcp" else f"/{port.protocol}"
        )
        if entry not in seen:
            seen.add(entry)
            lines.append(f'      - "{entry}"')
    return "\n".join(lines) + "\n"


def host_port_in_use(port, timeout=0.5):
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=timeout):
            return True
    except OSError:
        return False


GIT_SSH_COMMAND = "ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"


def merge_wslenv(current, names):
    entries = [entry for entry in str(current or "").split(":") if entry]
    known = {entry.split("/", 1)[0] for entry in entries}
    entries.extend(name for name in names if name not in known)
    return ":".join(entries)


def terminate_active_processes(wait_seconds=0.5):
    with ACTIVE_PROCESSES_LOCK:
        processes = list(ACTIVE_PROCESSES)

    for process in processes:
        if process.poll() is None:
            try:
                process.terminate()
            except OSError:
                pass

    deadline = time.monotonic() + wait_seconds
    for process in processes:
        remaining = max(0, deadline - time.monotonic())
        if process.poll() is None:
            try:
                process.wait(timeout=remaining)
            except (subprocess.TimeoutExpired, OSError):
                try:
                    process.kill()
                except OSError:
                    pass


# Dernière ligne d'un traceback Python : « ValueError: … », mais aussi « psycopg2.errors.InsufficientPrivilege: … »,
# dont la classe ne finit pas par Error. Les lignes de log Odoo (« odoo.service.server: … ») portent un préfixe
# horodaté et sont traitées avant, une exception dotée d'un nom de module commence la ligne.
# « manifest for img:tag not found » (tag absent) et « pull access denied for img » (dépôt absent).
MISSING_IMAGE_RE = re.compile(r"(?:manifest for|pull access denied for) ([^\s,]+?)(?: not found|,|$)")
PYTHON_EXCEPTION_LINE_RE = re.compile(r"\b[A-Za-z_][\w.]*(?:Error|Exception|Fault):\s*\S|^[A-Za-z_]\w*(?:\.\w+)+:\s*\S")
# Extension que l'image PostgreSQL n'embarque pas (l'image officielle `postgres` n'a pas pgvector).
POSTGRES_EXTENSION_UNAVAILABLE_RE = re.compile(
    r'extension "[\w-]+" is not available|could not open extension control file', re.IGNORECASE
)
PGVECTOR_IMAGE_REQUIRED_MESSAGE = (
    "L'IA d'Odoo a besoin de l'extension « vector », absente du serveur de bases PostgreSQL de ce projet. "
    "Dans le docker-compose.yml du projet, remplace l'image PostgreSQL par pgvector/pgvector de la même version "
    "(ex. postgres:16 → pgvector/pgvector:pg16), recrée le conteneur PostgreSQL, puis relance."
)


class TracebackChain:
    """Suit les tracebacks Python enchaînés pour retrouver l'exception d'origine.

    Odoo enveloppe l'erreur réelle (« External ID not found… ») dans un ParseError final qui
    ne dit rien seul : elle n'apparaît que dans le traceback précédent, relié par « The above
    exception was the direct cause… ».
    """

    CONNECTORS = ("The above exception was the direct cause", "During handling of the above exception")

    def __init__(self):
        self.root = None
        self._chained = False

    def feed(self, line):
        if line.startswith("Traceback (most recent call last)"):
            if not self._chained:
                self.root = None
            self._chained = False
        elif line.startswith(self.CONNECTORS):
            self._chained = True
        elif self.root is None and PYTHON_EXCEPTION_LINE_RE.search(line) and not line.startswith(("File ", " ")):
            self.root = line

    def origin_of(self, final_exception):
        """Suffixe « cause d'origine » si la cause diffère de l'exception finale."""
        if not self.root or self.root == final_exception:
            return ""
        return f" — cause d'origine : {self.root[:250]}"


class OdooError(RuntimeError):
    """Échec rapporté par Odoo lui-même (code des modules, données de la base).

    Le gestionnaire a bien lancé la commande : l'interface l'affiche à part des erreurs
    du gestionnaire (Docker, réseau, fichiers, validation), qui restent des RuntimeError.
    """


class MissingPythonDependency(OdooError):
    """Odoo ne charge pas une base faute d'un paquet Python dans son conteneur."""

    def __init__(self, import_name, reason=""):
        self.import_name = import_name
        self.package = python_package_for_import(import_name)
        super().__init__(
            f"Odoo ne charge pas la base : le paquet Python « {self.package} » manque dans le conteneur. {reason}".strip()
        )


def module_command_expected_seconds(modules):
    """Durée habituelle d'une installation ou mise à jour : elle règle la vitesse de la barre quand Odoo se tait."""
    names = [name for name in str(modules).split(",") if name.strip()]
    if "all" in names:
        return 600
    return min(45 + 15 * len(names), 600)


class ProjectService:
    def __init__(self, settings, workspace, traefik_dir=None, runner=None, http_probe=None, port_in_use=None):
        self.settings = settings
        self.workspace = Path(workspace)
        self.traefik_dir = Path(traefik_dir).expanduser() if traefik_dir else None
        self.runner = runner
        self.http_probe = http_probe
        self.port_in_use = port_in_use
        self._traefik = None
        self._traefik_detected = False

    def env(self):
        env = os.environ.copy()
        env["PATH"] = executable_search_path()
        env["GIT_TERMINAL_PROMPT"] = "0"
        env.setdefault("GIT_SSH_COMMAND", GIT_SSH_COMMAND)
        if platform.system() == "Windows":
            # wsl.exe ne transmet que les variables listées dans WSLENV : sans elles, Git dans WSL
            # pouvait attendre une réponse SSH (clé d'hôte inconnue) sans terminal.
            forwarded = ["GIT_TERMINAL_PROMPT"]
            if env["GIT_SSH_COMMAND"] == GIT_SSH_COMMAND:
                forwarded.append("GIT_SSH_COMMAND")
            env["WSLENV"] = merge_wslenv(env.get("WSLENV", ""), forwarded)
        return env

    def log(self, callback, message):
        if callback:
            callback(message)

    def stream(self, command, cwd=None, log=None):
        cwd = Path(cwd or self.workspace)
        command, process_cwd = self.prepare_command(command, cwd)
        if self.runner:
            return self.runner.stream(command, cwd=process_cwd, log=log)

        jobs.checkpoint()
        self.log(log, "$ " + " ".join(str(arg) for arg in command))
        process = subprocess.Popen(
            command,
            cwd=str(process_cwd),
            env=self.env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            **hidden_process_kwargs(),
        )
        with ACTIVE_PROCESSES_LOCK:
            ACTIVE_PROCESSES.add(process)
        jobs.track_process(process)
        try:
            assert process.stdout is not None
            for line in process.stdout:
                self.log(log, line)
            code = process.wait()
        except BaseException:
            # Une commande sans lecteur continuerait en arrière-plan, par exemple
            # un `odoo -i` concurrent du redémarrage du serveur.
            process.kill()
            process.wait()
            raise
        finally:
            jobs.untrack_process(process)
            if process.stdout is not None:
                process.stdout.close()
            with ACTIVE_PROCESSES_LOCK:
                ACTIVE_PROCESSES.discard(process)
        self.log(log, f"Code retour: {code}")
        jobs.checkpoint()
        return code

    def capture(self, command, cwd=None, timeout=10):
        cwd = Path(cwd or self.workspace)
        command, process_cwd = self.prepare_command(command, cwd)
        if self.runner:
            return self.runner.capture(command, cwd=process_cwd, timeout=timeout)

        try:
            result = jobs.run_process(
                command,
                timeout,
                cwd=str(process_cwd),
                env=self.env(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                **hidden_process_kwargs(),
            )
            stdout = (result.stdout or "").strip()
            stderr = (result.stderr or "").strip()
            if result.returncode == 0:
                return result.returncode, stdout or stderr
            return result.returncode, "\n".join(part for part in (stdout, stderr) if part)
        except OSError as exc:
            return 127, str(exc)
        except subprocess.TimeoutExpired as exc:
            return 124, (exc.stdout or "").strip()

    def feed_process(self, command, produce, log=None, on_error_line=None):
        """Lance `command`, écrit sur son entrée ce que `produce(entrée)` y envoie et retourne son code.

        Sa sortie standard est ignorée : psql y affiche le résultat de chaque SELECT d'un dump.
        Chaque ligne de sa sortie d'erreur part vers `on_error_line` au fil de l'eau.
        """
        if self.runner:
            return self.runner.feed(command, produce, log=log, on_error_line=on_error_line)
        command, process_cwd = self.prepare_command(command, self.workspace)
        jobs.checkpoint()
        self.log(log, "$ " + " ".join(str(arg) for arg in command))
        process = subprocess.Popen(
            command,
            cwd=str(process_cwd),
            env=self.env(),
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            **hidden_process_kwargs(),
        )
        with ACTIVE_PROCESSES_LOCK:
            ACTIVE_PROCESSES.add(process)
        jobs.track_process(process)

        def read_errors():
            for raw in process.stderr:
                line = raw.decode("utf-8", errors="replace").rstrip()
                if line and on_error_line:
                    on_error_line(line)

        reader = threading.Thread(target=read_errors, name="process-errors", daemon=True)
        reader.start()
        try:
            try:
                produce(process.stdin)
            except BrokenPipeError:
                # Le processus s'est arrêté avant la fin des données : son code de sortie le dira.
                pass
            finally:
                try:
                    process.stdin.close()
                except OSError:
                    pass
            code = process.wait()
            reader.join(timeout=30)
        except BaseException:
            process.kill()
            process.wait()
            raise
        finally:
            jobs.untrack_process(process)
            with ACTIVE_PROCESSES_LOCK:
                ACTIVE_PROCESSES.discard(process)
        self.log(log, f"Code retour: {code}")
        jobs.checkpoint()
        return code

    def docker(self, *arguments):
        return docker_command(self.settings, *arguments)

    def prepare_command(self, command, cwd):
        command = [str(argument) for argument in command]
        if platform.system() != "Windows" or not command_uses_wsl(command):
            return command, cwd
        prepared = wsl_command_with_cwd(command, cwd, self.settings, self.workspace)
        return prepared, Path.home()

    def git(self, *arguments):
        context = workspace_wsl_context(self.settings, self.workspace) if platform.system() == "Windows" else None
        distribution = context.distribution if context else self.settings.wsl_distribution
        native_available = host_executable_available("git")
        # Git pour Windows suffit hors workspace WSL : aucune sonde WSL dans ce cas.
        needs_wsl_probe = bool(context) or not native_available
        wsl_distribution = find_wsl_executable_distribution("git", distribution) if needs_wsl_probe else None
        wsl_available = wsl_distribution is not None
        if (context and wsl_available) or (not native_available and wsl_available):
            return [*wsl_command_prefix(wsl_distribution), "git", *arguments]
        return [resolve_host_executable("git"), *arguments]

    def command_path(self, command, path):
        if command_uses_wsl(command):
            return workspace_execution_path(path, self.settings, self.workspace)
        return str(path)

    def project_path(self, project):
        return self.workspace / project

    def compose_file(self, project):
        path = self.project_path(project)
        for name in COMPOSE_FILENAMES:
            candidate = path / name
            try:
                exists = candidate.exists()
            except OSError:
                return None
            if exists:
                return candidate
        return None

    def list_projects(self):
        try:
            workspace_available = self.workspace.is_dir()
        except OSError:
            return []
        if not workspace_available:
            return []
        projects = []
        try:
            items = tuple(self.workspace.iterdir())
        except OSError:
            return []
        for item in items:
            try:
                is_directory = item.is_dir()
            except OSError:
                continue
            if not is_directory:
                continue
            try:
                has_compose = any((item / name).exists() for name in COMPOSE_FILENAMES)
            except OSError:
                continue
            if has_compose:
                projects.append(item.name)
        return sorted(projects)

    def container_status(self, container):
        code, output = self.capture(self.docker("inspect", "-f", "{{.State.Status}}", container), timeout=5)
        if code != 0 or not output:
            return "absent"
        return output.splitlines()[0].strip()

    def is_running(self, container):
        return self.container_status(container) == "running"

    def container_health(self, container):
        health_format = "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}"
        code, output = self.capture(
            self.docker("inspect", "-f", health_format, container),
            timeout=5,
        )
        if code != 0 or not output:
            return "absent"
        return output.splitlines()[0].strip().lower()

    def container_startup_diagnostics(self, container, log=None):
        health_format = "{{if .State.Health}}{{json .State.Health}}{{else}}null{{end}}"
        health_code, health = self.capture(
            self.docker("inspect", "-f", health_format, container),
            timeout=8,
        )
        logs_code, logs = self.capture(
            self.docker("logs", "--tail", "80", container),
            timeout=12,
        )
        if health_code == 0 and health and health != "null":
            self.log(log, "Dernier état du contrôle de santé PostgreSQL:")
            self.log(log, health)
        if logs_code == 0 and logs:
            self.log(log, "Derniers logs PostgreSQL:")
            self.log(log, logs)

    def wait_for_postgres(self, project, max_wait=180, log=None, sleep=None):
        sleep = sleep or jobs.sleep
        container = f"postgresql-{project}"
        waited = 0
        last_state = None
        while waited <= max_wait:
            status = self.container_status(container)
            health = self.container_health(container) if status == "running" else "none"
            state = (status, health)
            if state != last_state or waited % 10 == 0:
                self.log(
                    log,
                    f"Attente PostgreSQL... {waited}s/{max_wait}s (conteneur: {status}, santé: {health})",
                )
                last_state = state
            if status == "running" and health in {"healthy", "none"}:
                return
            if status in {"dead", "exited", "paused"}:
                self.container_startup_diagnostics(container, log=log)
                raise RuntimeError(f"PostgreSQL s'est arrêté pendant son démarrage ({status}).")
            sleep(2)
            waited += 2

        self.container_startup_diagnostics(container, log=log)
        raise RuntimeError(
            f"PostgreSQL n'est pas devenu sain après {max_wait}s. "
            "Consulte les contrôles de santé et les logs affichés ci-dessus."
        )

    def recover_postgres_dependency(self, project, path, log=None):
        container = f"postgresql-{project}"
        status = self.container_status(container)
        health = self.container_health(container) if status == "running" else "none"
        if status != "running" or health not in {"starting", "unhealthy", "healthy"}:
            return None

        self.log(log, "")
        self.log(
            log,
            "PostgreSQL est encore en phase de démarrage. "
            "Le gestionnaire attend sa disponibilité sans recréer le volume de données.",
        )
        self.wait_for_postgres(project, log=log)
        self.log(log, "PostgreSQL est prêt. Reprise du démarrage Odoo...")
        return self.stream(
            self.docker("compose", "up", "-d", "--no-recreate"),
            cwd=path,
            log=log,
        )

    def recover_macos_postgres_bootstrap(self, project, path, log=None):
        """Retry Docker Desktop's first PostgreSQL bind-mount bootstrap safely.

        On some macOS Docker Desktop versions, the temporary PostgreSQL process
        used by the image entrypoint cannot use a freshly-created bind mount.
        The cluster is written, but initdb.sql is skipped before the container
        exits. A second start uses the initialized cluster successfully.
        """
        if platform.system() != "Darwin":
            return None
        container = f"postgresql-{project}"
        if self.container_status(container) != "exited":
            return None
        logs_code, logs = self.capture(self.docker("logs", "--tail", "120", container), timeout=12)
        if logs_code != 0 or "data directory" not in logs.lower() or "wrong ownership" not in logs.lower():
            return None

        config = self.project_path(project) / "odoo.conf"
        try:
            content = config.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return None
        user_match = re.search(r"(?m)^\s*db_user\s*=\s*([^\s#;]+)", content)
        password_match = re.search(r"(?m)^\s*db_password\s*=\s*(.*?)\s*$", content)
        if not user_match or not password_match:
            return None
        db_user = user_match.group(1)
        db_password = password_match.group(1)
        quoted_user = db_user.replace('"', '""')
        quoted_password = db_password.replace("'", "''")

        self.log(log, "Docker Desktop macOS a interrompu l'initialisation PostgreSQL sur le montage local.")
        self.log(log, "Reprise contrôlée du cluster neuf et création du rôle Odoo manquant...")
        code = self.stream(self.docker("compose", "up", "-d", "--no-recreate"), cwd=path, log=log)
        if code != 0:
            return code
        try:
            self.wait_for_postgres(project, log=log)
        except RuntimeError:
            return 1
        role_sql = (
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '"
            + db_user.replace("'", "''")
            + "') THEN CREATE ROLE \""
            + quoted_user
            + "\" LOGIN ENCRYPTED PASSWORD '"
            + quoted_password
            + "' CREATEDB; END IF; END $$;"
        )
        role_code, role_output = self.capture(
            self.docker(
                "exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", role_sql
            ),
            timeout=20,
        )
        if role_code != 0:
            self.log(log, role_output or "Impossible de créer le rôle Odoo après la reprise PostgreSQL.")
            return role_code
        self.log(log, "PostgreSQL macOS repris; le rôle Odoo est disponible.")
        return 0

    def fix_postgres_healthcheck_start_period(self, compose_file, log=None):
        try:
            content = compose_file.read_text(encoding="utf-8")
        except OSError:
            return
        updated, changed = add_postgres_healthcheck_start_period(content)
        if not changed:
            return
        backup = compose_file.with_name(f"{compose_file.name}.healthcheck.bak.{time.strftime('%Y%m%d_%H%M%S')}")
        try:
            shutil.copy2(compose_file, backup)
            compose_file.write_text(updated, encoding="utf-8")
        except OSError as exc:
            self.log(log, f"Healthcheck PostgreSQL non adapté ({exc}).")
            return
        self.log(
            log,
            f"Healthcheck PostgreSQL : start_period {POSTGRES_HEALTHCHECK_START_PERIOD} ajouté dans {compose_file.name} "
            "(pris en compte à la prochaine recréation du conteneur).",
        )
        self.log(log, f"Sauvegarde: {backup}")

    def fix_macos_localtime_mount(self, compose_file, log=None):
        if platform.system() != "Darwin":
            return
        try:
            content = compose_file.read_text(encoding="utf-8")
        except OSError:
            return
        if "/etc/localtime:/etc/localtime:ro" not in content:
            return

        backup = compose_file.with_name(f"{compose_file.name}.localtime.bak.{time.strftime('%Y%m%d_%H%M%S')}")
        shutil.copy2(compose_file, backup)
        filtered = "\n".join(line for line in content.splitlines() if "/etc/localtime:/etc/localtime:ro" not in line)
        compose_file.write_text(filtered + "\n", encoding="utf-8")
        self.log(log, f"Mount /etc/localtime supprimé du compose macOS: {compose_file}")
        self.log(log, f"Sauvegarde: {backup}")

    def project_url(self, project, refresh_traefik=False):
        compose = self.compose_file(project)
        if compose:
            try:
                content = compose.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                content = ""
            marker = "Host(`"
            if marker in content:
                host = content.split(marker, 1)[1].split("`)", 1)[0]
                if host:
                    return url_with_port(f"http://{host}/", self.traefik_http_port(refresh=refresh_traefik))

        code, output = self.capture(self.docker("port", f"odoo-{project}", "8069/tcp"), timeout=1)
        if code == 0 and output:
            first = output.splitlines()[0].strip()
            port = first.rsplit(":", 1)[-1]
            if port.isdigit():
                return f"http://localhost:{port}/"
        return url_with_port(f"http://dev.{project}.localhost/", self.traefik_http_port(refresh=refresh_traefik))

    def traefik_compose_path(self):
        if not self.traefik_dir:
            return None
        try:
            return next(
                (self.traefik_dir / name for name in COMPOSE_FILENAMES if (self.traefik_dir / name).is_file()), None
            )
        except OSError:
            return None

    def traefik_compose_text(self):
        base = self.traefik_compose_path()
        try:
            return base.read_text(encoding="utf-8", errors="ignore") if base else ""
        except OSError:
            return ""

    def traefik_instances(self):
        """Conteneurs Traefik de la machine ; None quand Docker ne répond pas."""
        return detect_traefik_instances(self.capture, self.docker())

    def is_managed_traefik(self, instance):
        """Vrai pour le conteneur créé par compose depuis le dossier Traefik configuré."""
        if not self.traefik_dir or not instance.working_dir:
            return False
        try:
            resolved = self.traefik_dir.resolve()
        except OSError:
            resolved = self.traefik_dir
        if same_directory(instance.working_dir, self.traefik_dir, resolved):
            return True
        try:
            # Docker dans WSL enregistre le dossier sous sa forme Linux.
            execution_directory = self.command_path(self.docker(), self.traefik_dir)
        except (OSError, RuntimeError):
            return False
        return same_directory(instance.working_dir, execution_directory)

    def traefik_instance(self, refresh=False):
        if refresh or not self._traefik_detected:
            self.use_traefik_instance(select_traefik_instance(self.traefik_instances() or [], self.is_managed_traefik))
        return self._traefik

    def use_traefik_instance(self, instance):
        self._traefik, self._traefik_detected = instance, True

    def configured_traefik_http_port(self):
        """Port HTTP que publiera le compose de Traefik, lu tant que le conteneur n'est pas démarré."""
        ports = compose_service_ports(self.traefik_compose_text())
        if not ports:
            return None
        entrypoints = None
        for name in TRAEFIK_CONFIG_FILENAMES:
            try:
                path = self.traefik_dir / name
                if path.is_file():
                    entrypoints = entrypoints_from_config(path.read_text(encoding="utf-8", errors="ignore"))
                    break
            except OSError:
                continue
        configured = TraefikInstance("", "traefik", "", "configured", published=tuple(ports), entrypoints=entrypoints)
        return configured.http_port

    def traefik_http_port(self, refresh=False):
        instance = self.traefik_instance(refresh=refresh)
        if instance and instance.running and instance.http_port:
            return instance.http_port
        return self.traefik_http_port_from_config()

    def traefik_http_port_from_config(self):
        return self.configured_traefik_http_port() or TRAEFIK_DEFAULT_HTTP_PORT

    def traefik_container_name(self):
        instance = self.traefik_instance()
        if instance:
            return instance.name
        return compose_service_container_name(self.traefik_compose_text()) or "traefik"

    def start_traefik(self, log=None):
        instances = self.traefik_instances() or []
        managed = [instance for instance in instances if self.is_managed_traefik(instance)]
        foreign = [instance for instance in instances if instance not in managed]
        managed_running = any(instance.running for instance in managed)
        compose_text = self.traefik_compose_text()
        ports = compose_service_ports(compose_text) or []

        if not managed_running:
            existing = self.reusable_traefik(foreign, ports, log=log)
            if existing:
                self.use_traefik_instance(existing)
                self.announce_traefik(existing, log=log)
                self.ensure_traefik_port_reachable(log=log)
                return

        if not self.traefik_dir or not self.traefik_dir.exists():
            self.log(log, f"Traefik introuvable: {self.traefik_dir or ''}".rstrip())
            return
        if not any((self.traefik_dir / name).exists() for name in COMPOSE_FILENAMES):
            self.log(log, f"Dossier Traefik sans compose: {self.traefik_dir}")
            return

        if not managed_running:
            # Docker refuserait de créer le conteneur : le dire tout de suite plutôt qu'après un compose en échec.
            self.ensure_traefik_container_name_free(compose_text, foreign)
            conflict = self.traefik_port_conflict(ports, foreign)
            if conflict:
                port, owner = conflict
                raise RuntimeError(
                    f"Le port {port.host_port} de cette machine est déjà utilisé par {owner} : "
                    f"Traefik ne peut pas le publier. Libère ce port, ou change le port publié dans "
                    f'{self.traefik_compose_path()} (par exemple "8080:{port.container_port}") : '
                    "le gestionnaire utilisera automatiquement le nouveau port."
                )

        self.log(log, "Démarrage de Traefik...")
        compose_files = self.traefik_loopback_compose_files(log=log)
        code = self.stream(self.docker("compose", *compose_files, "up", "-d"), cwd=self.traefik_dir, log=log)
        if code != 0:
            raise RuntimeError("Impossible de démarrer Traefik.")
        self.announce_traefik(self.traefik_instance(refresh=True), log=log)
        self.ensure_traefik_port_reachable(log=log)

    def reusable_traefik(self, foreign, ports, log=None):
        """Instance Traefik déjà démarrée hors du dossier configuré et capable de servir les projets."""
        usable = []
        for instance in foreign:
            if not instance.running:
                continue
            problems = instance.compatibility_problems()
            if problems:
                self.log(log, f"Instance Traefik existante ignorée : {instance.describe()} ; {'; '.join(problems)}.")
            else:
                usable.append(instance)
        if not usable:
            return None

        complete = [instance for instance in usable if not self.missing_traefik_middlewares(instance)]
        if complete:
            instance = select_traefik_instance(complete, lambda _instance: False)
            self.log(log, f"Instance Traefik existante détectée : {instance.describe()}. Elle est réutilisée.")
            return instance

        instance = select_traefik_instance(usable, lambda _instance: False)
        missing = ", ".join(f"{name}@docker" for name in self.missing_traefik_middlewares(instance))
        if self.traefik_compose_path() and not self.traefik_port_conflict(ports, foreign):
            self.log(
                log,
                f"Instance Traefik existante détectée : {instance.describe()}, sans les middlewares {missing} "
                "utilisés par les projets. Démarrage de l'instance docker-local-tools à la place.",
            )
            return None
        self.log(
            log,
            f"Instance Traefik existante détectée : {instance.describe()}. Elle est réutilisée, mais aucun conteneur "
            f"ne définit les middlewares {missing} : les routes des projets qui les utilisent resteront en 404.",
        )
        return instance

    def missing_traefik_middlewares(self, instance):
        missing = instance.missing_middlewares
        if not missing:
            return ()
        # Les middlewares @docker peuvent être déclarés par un autre conteneur que Traefik.
        code, output = self.capture(self.docker("ps", "--no-trunc", "--format", "{{.Labels}}"), timeout=8)
        if code != 0:
            return ()
        labels = (output or "").lower()
        return tuple(name for name in missing if f"traefik.http.middlewares.{name}.".lower() not in labels)

    def ensure_traefik_container_name_free(self, compose_text, foreign):
        name = compose_service_container_name(compose_text)
        holder = next((instance for instance in foreign if name and instance.name == name), None)
        if holder is None:
            return
        origin = f"créé depuis {holder.working_dir}" if holder.working_dir else "créé hors de docker compose"
        problems = holder.compatibility_problems() if holder.running else []
        detail = f" Il ne peut pas servir les projets : {'; '.join(problems)}." if problems else ""
        raise RuntimeError(
            f"Un conteneur « {name} » existe déjà ({holder.describe()}, {origin}) : Docker ne peut pas créer "
            f"celui de {self.traefik_dir}.{detail} Démarre-le (docker start {name}) s'il s'agit de ton instance "
            f"Traefik, ou supprime-le (docker rm -f {name}), puis relance le démarrage."
        )

    def traefik_port_conflict(self, ports, instances):
        """(port, occupant) du premier port du compose de Traefik déjà pris sur la machine."""
        for port in ports:
            if port.protocol != "tcp":
                continue
            holder = next(
                (
                    instance
                    for instance in instances
                    if instance.running
                    and any(
                        published.host_port == port.host_port and published.protocol == "tcp"
                        for published in instance.published
                    )
                ),
                None,
            )
            if holder:
                return port, f"le conteneur Traefik {holder.describe()}"
            if self.host_port_in_use(port.host_port):
                return port, self.port_owner(port.host_port) or "un autre service"
        return None

    def host_port_in_use(self, port):
        if self.port_in_use:
            return self.port_in_use(port)
        if self.runner is not None:
            return False
        return host_port_in_use(port)

    def port_owner(self, port):
        """Description de ce qui écoute sur un port de la machine ; chaîne vide si inconnu."""
        code, output = self.capture(
            self.docker("ps", "--filter", f"publish={port}", "--format", "{{.Names}}"), timeout=8
        )
        names = [line.strip() for line in (output or "").splitlines() if line.strip()] if code == 0 else []
        if names:
            return f"le conteneur Docker {names[0]}"
        if platform.system() == "Windows":
            code, output = self.capture([resolve_host_executable("netstat"), "-ano", "-p", "TCP"], timeout=8)
            pid = None
            for line in (output or "").splitlines() if code == 0 else ():
                parts = line.split()
                # L'état est traduit selon la langue de Windows : un socket en écoute a un distant en :0.
                if (
                    len(parts) >= 4
                    and parts[0].upper() == "TCP"
                    and parts[-1].isdigit()
                    and parts[1].rsplit(":", 1)[-1] == str(port)
                    and parts[2].rsplit(":", 1)[-1] == "0"
                ):
                    pid = parts[-1]
                    break
            if not pid:
                return ""
            if pid == "4":
                return "le service HTTP de Windows (processus System : IIS, HTTP.sys...)"
            code, output = self.capture(
                [resolve_host_executable("tasklist"), "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                timeout=8,
            )
            name = output.split(",", 1)[0].strip('"') if code == 0 and (output or "").startswith('"') else ""
            return f"le processus {name} (PID {pid})" if name else f"le processus PID {pid}"
        code, output = self.capture(
            [resolve_host_executable("lsof"), "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-Fpc"], timeout=8
        )
        if code != 0 or not output:
            return ""
        values = {}
        for line in output.splitlines():
            if line[:1] in {"p", "c"} and line[:1] not in values:
                values[line[:1]] = line[1:]
        return f"le processus {values['c']} (PID {values.get('p', '?')})" if values.get("c") else ""

    def announce_traefik(self, instance, log=None):
        if instance is None or not instance.running:
            return
        port = instance.http_port
        if port is None:
            raise RuntimeError(
                f"Traefik ({instance.describe()}) est démarré mais son entrypoint HTTP n'est publié sur aucun port "
                "de cette machine : les projets seraient injoignables. Publie ce port dans le compose de Traefik."
            )
        if port == TRAEFIK_DEFAULT_HTTP_PORT:
            self.log(log, f"Traefik prêt : conteneur {instance.name}, port HTTP {port}.")
        else:
            self.log(
                log,
                f"Traefik prêt : conteneur {instance.name}, port HTTP {port} (port personnalisé). "
                f"Les URL des projets utilisent ce port, par exemple http://dev.<projet>.localhost:{port}/.",
            )

    def traefik_port_probe(self):
        # Toute réponse HTTP (même 404) prouve que la redirection du port vers Traefik fonctionne.
        url = url_with_port("http://traefik.localhost/api/overview", self.traefik_http_port())
        if self.http_probe:
            result = self.http_probe(url)
            return result if isinstance(result, tuple) else (result, "")
        return self.http_probe_result(url, timeout=5)

    def ensure_traefik_port_reachable(self, log=None, sleep=None):
        """Répare la redirection de port de Docker Desktop quand Traefik tourne sans répondre.

        Docker Desktop perd la redirection du port quand Traefik est recréé avec une autre
        adresse de publication, ou après une veille Windows : le conteneur est running mais
        chaque connexion est refusée ou coupée. Un redémarrage du conteneur la rétablit.
        """
        if self.runner is not None and self.http_probe is None:
            return True
        sleep = sleep or jobs.sleep
        status, reason = self.traefik_port_probe()
        container = self.traefik_container_name()
        if status or reason not in {"refused", "reset"} or self.container_status(container) != "running":
            return bool(status)
        port = self.traefik_http_port()
        self.log(
            log,
            f"Traefik tourne mais le port {port} ne répond pas depuis cette machine "
            f"({HTTP_FAILURE_LABELS[reason].format(port=port)}). "
            f"Redémarrage du conteneur {container} pour rétablir la redirection de port de Docker...",
        )
        if self.stream(self.docker("restart", container), log=log) != 0:
            return False
        for _ in range(TRAEFIK_PORT_WAIT_SECONDS):
            sleep(1)
            status, reason = self.traefik_port_probe()
            if status:
                self.log(log, f"Redirection du port {port} rétablie.")
                return True
        return False

    def compose_version(self):
        code, output = self.capture(self.docker("compose", "version", "--short"), timeout=15)
        match = re.search(r"(\d+)\.(\d+)\.(\d+)", output or "") if code == 0 else None
        return tuple(int(part) for part in match.groups()) if match else None

    def traefik_loopback_compose_files(self, log=None):
        """Restreint Traefik à 127.0.0.1 sans modifier le dépôt docker-local-tools ni ses ports."""
        base = self.traefik_compose_path()
        base_text = self.traefik_compose_text()
        if compose_service_block(base_text, "traefik") is None:
            self.log(log, "Service traefik introuvable dans le compose : ports laissés tels quels.")
            return []
        ports = compose_service_ports(base_text, "traefik")
        if not ports:
            self.log(
                log,
                "Ports de Traefik non reconnus dans le compose (variables, syntaxe longue ou aucun port) : "
                "ports laissés tels quels.",
            )
            return []
        version = self.compose_version()
        if not version or version < COMPOSE_OVERRIDE_TAG_MIN_VERSION:
            self.log(
                log,
                "Docker Compose trop ancien pour restreindre Traefik à cette machine "
                "(2.24.4 requis) : Traefik reste joignable depuis le réseau.",
            )
            return []
        override = self.workspace / ".odoo_manager_runtime" / "traefik-loopback.compose.yml"
        content = traefik_loopback_override("traefik", ports)
        try:
            override.parent.mkdir(parents=True, exist_ok=True)
            if not override.is_file() or override.read_text(encoding="utf-8") != content:
                override.write_text(content, encoding="utf-8")
        except OSError as exc:
            self.log(log, f"Surcharge Traefik impossible à écrire ({exc}) : ports laissés tels quels.")
            return []
        docker_prefix = self.docker()
        return [
            "-f",
            self.command_path(docker_prefix, base),
            "-f",
            self.command_path(docker_prefix, override),
        ]

    def install_traefik(self, repository, log=None):
        if not self.traefik_dir:
            raise RuntimeError("Le dossier Traefik n'est pas configuré.")
        if self.traefik_dir.name != "traefik":
            raise RuntimeError("Le dossier Traefik doit se terminer par docker-local-tools/traefik.")

        tools_dir = self.traefik_dir.parent
        parent_dir = tools_dir.parent
        compose_ready = any((self.traefik_dir / name).is_file() for name in COMPOSE_FILENAMES)
        git = self.git

        if compose_ready and not (tools_dir / ".git").is_dir():
            self.log(log, f"Traefik déjà présent: {self.traefik_dir}")
            self.start_traefik(log=log)
            return

        if tools_dir.exists():
            if not (tools_dir / ".git").is_dir():
                raise RuntimeError(f"Le dossier {tools_dir} existe mais n'est pas un dépôt Git exploitable.")
            self.log(log, "Mise à jour de docker-local-tools...")
            code = self.stream(git("pull", "--ff-only"), cwd=tools_dir, log=log)
            if code != 0:
                raise RuntimeError("Impossible de mettre à jour docker-local-tools.")
        else:
            parent_dir.mkdir(parents=True, exist_ok=True)
            temporary = parent_dir / f".{tools_dir.name}.odoo-manager-{uuid.uuid4().hex}"
            self.log(log, "Installation de docker-local-tools...")
            try:
                clone_prefix = git("clone", repository)
                clone_destination = self.command_path(clone_prefix, temporary)
                code = self.stream([*clone_prefix, clone_destination], cwd=parent_dir, log=log)
                if code != 0:
                    raise RuntimeError("Impossible de cloner docker-local-tools. Vérifie Git et ta clé SSH GitLab.")
                temporary_traefik = temporary / "traefik"
                if not any((temporary_traefik / name).is_file() for name in COMPOSE_FILENAMES):
                    raise RuntimeError("Le dépôt docker-local-tools ne contient pas de configuration Traefik valide.")
                temporary.replace(tools_dir)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary, ignore_errors=True)

        if not any((self.traefik_dir / name).is_file() for name in COMPOSE_FILENAMES):
            raise RuntimeError(f"Configuration Traefik introuvable après installation: {self.traefik_dir}")
        self.start_traefik(log=log)

    def compose_container_ids(self, path):
        code, output = self.capture(self.docker("compose", "ps", "-aq"), cwd=path, timeout=10)
        if code != 0 or not output:
            return []
        return [line.strip() for line in output.splitlines() if line.strip()]

    def stale_macos_localtime_mounts(self, path):
        if platform.system() != "Darwin":
            return []

        mount_format = '{{range .Mounts}}{{if eq .Destination "/etc/localtime"}}{{.Source}}{{end}}{{end}}'
        stale = []
        for container_id in self.compose_container_ids(path):
            code, source = self.capture(
                self.docker("inspect", "-f", mount_format, container_id),
                timeout=5,
            )
            if code == 0 and source.strip():
                stale.append((container_id, source.strip()))
        return stale

    def stale_container_networks(self, path):
        network_format = (
            "{{range $name, $network := .NetworkSettings.Networks}}{{$name}}|{{$network.NetworkID}};{{end}}"
        )
        stale = []
        checked = set()
        for container_id in self.compose_container_ids(path):
            code, output = self.capture(
                self.docker("inspect", "-f", network_format, container_id),
                timeout=5,
            )
            if code != 0:
                continue
            for item in output.split(";"):
                if "|" not in item:
                    continue
                network_name, network_id = (part.strip() for part in item.split("|", 1))
                if not network_id or network_id in checked:
                    continue
                checked.add(network_id)
                inspect_code, inspect_output = self.capture(
                    self.docker("network", "inspect", network_id),
                    timeout=5,
                )
                error = inspect_output.lower()
                missing_network = (
                    "not found" in error or "no such network" in error or inspect_output.strip() in {"[]", "null"}
                )
                if inspect_code != 0 and missing_network:
                    stale.append((container_id, network_name, network_id))
        return stale

    def recreate_stale_containers(self, path, stale_mounts, stale_networks, log=None):
        if stale_mounts:
            self.log(log, "Ancien montage macOS /etc/localtime détecté dans les conteneurs.")
            for container_id, source in stale_mounts:
                self.log(log, f" - {container_id[:12]}: {source} -> /etc/localtime")
        if stale_networks:
            self.log(log, "Ancien réseau Docker supprimé détecté dans les conteneurs.")
            for container_id, network_name, network_id in stale_networks:
                self.log(
                    log,
                    f" - {container_id[:12]}: {network_name} ({network_id[:12]})",
                )
        self.log(log, "Recréation contrôlée des conteneurs; les volumes et dossiers de données sont conservés.")
        return self.stream(
            self.docker("compose", "up", "-d", "--force-recreate"),
            cwd=path,
            log=log,
        )

    def compose_up_project(self, project, path, log=None, recreate_changed=False):
        # Une image absente du registre (branche du template publiée avant son image, par
        # exemple) ne se lit que dans la sortie de Compose : le code retour seul reste muet.
        missing_images = []
        log_output = log

        def log(line):
            for image in MISSING_IMAGE_RE.findall(str(line)):
                if image not in missing_images:
                    missing_images.append(image)
            self.log(log_output, line)

        stale_mounts = self.stale_macos_localtime_mounts(path)
        stale_networks = self.stale_container_networks(path)
        if stale_mounts or stale_networks:
            self.log(log, "Anomalie Docker détectée avant démarrage.")
            code = self.recreate_stale_containers(path, stale_mounts, stale_networks, log=log)
        elif recreate_changed:
            # Après un pull : sans recréation, le conteneur existant gardait l'ancienne image.
            # Compose ne recrée que les conteneurs dont l'image ou la configuration a changé.
            self.log(log, "Démarrage des conteneurs ; ceux dont l'image a changé sont recréés...")
            code = self.stream(self.docker("compose", "up", "-d"), cwd=path, log=log)
        else:
            self.log(log, "Démarrage des conteneurs existants sans recréation...")
            code = self.stream(self.docker("compose", "up", "-d", "--no-recreate"), cwd=path, log=log)

        if code != 0:
            stale_mounts = self.stale_macos_localtime_mounts(path)
            stale_networks = self.stale_container_networks(path)
            if stale_mounts or stale_networks:
                self.log(log, "")
                self.log(log, "Anomalie Docker apparue pendant le démarrage.")
                code = self.recreate_stale_containers(path, stale_mounts, stale_networks, log=log)
            else:
                recovered_code = self.recover_macos_postgres_bootstrap(project, path, log=log)
                if recovered_code is None:
                    recovered_code = self.recover_postgres_dependency(project, path, log=log)
                if recovered_code is not None:
                    code = recovered_code
            if code != 0 and self.is_running(f"odoo-{project}"):
                self.log(log, f"Docker Compose a retourné une erreur, mais odoo-{project} est déjà running.")
                self.log(log, "Le gestionnaire continue avec le conteneur existant.")
                return
        if code != 0:
            status_code, status = self.capture(
                self.docker("compose", "ps", "-a"),
                cwd=path,
                timeout=10,
            )
            if status_code == 0 and status:
                self.log(log, "")
                self.log(log, "État des conteneurs du projet:")
                self.log(log, status)
            if missing_images:
                raise RuntimeError(
                    f"Image Docker introuvable sur le registre : {', '.join(missing_images)}. "
                    "Elle n'est pas (encore) publiée ; le projet démarrera une fois l'image disponible."
                )
            raise RuntimeError(
                "Docker Compose n'a pas démarré correctement. "
                "Les conteneurs existants et les données ont été conservées."
            )

    def wait_for_container(self, container, max_wait=60, log=None, sleep=None):
        sleep = sleep or jobs.sleep
        waited = 0
        while waited <= max_wait:
            status = self.container_status(container)
            self.log(log, f"Attente {container}... {waited}s/{max_wait}s ({status})")
            if status == "running":
                return
            if status not in {"absent", "created", "restarting"}:
                raise RuntimeError(f"Le conteneur {container} est en état {status}.")
            sleep(2)
            waited += 2
        raise RuntimeError(f"Le conteneur {container} n'est pas running après {max_wait}s.")

    def wait_for_odoo_container_initialization(
        self,
        container,
        max_wait=600,
        log=None,
        sleep=None,
    ):
        """Wait until the image entrypoint has installed project dependencies."""
        sleep = sleep or jobs.sleep
        waited = 0
        announced = False

        while waited <= max_wait:
            status = self.container_status(container)
            if status != "running":
                self.odoo_startup_diagnostics(container, log=log)
                raise RuntimeError(f"Le conteneur {container} s'est arrêté pendant sa préparation ({status}).")

            code, command = self.capture(
                self.docker("exec", container, "sh", "-lc", CONTAINER_MAIN_PROCESS_SCRIPT),
                timeout=8,
            )
            initializing = code != 0 or "/init.sh" in command
            if not initializing:
                if announced:
                    self.log(log, "Préparation du conteneur Odoo terminée.")
                return

            if not announced:
                self.log(
                    log,
                    "Préparation du conteneur Odoo: installation des dépendances système et Python...",
                )
                announced = True
            elif waited % 10 == 0:
                self.log(log, f"Préparation du conteneur Odoo... {waited}s/{max_wait}s")

            sleep(2)
            waited += 2

        self.odoo_startup_diagnostics(container, log=log)
        raise RuntimeError(
            f"La préparation du conteneur Odoo dépasse {max_wait}s. Consulte les logs affichés ci-dessus."
        )

    def odoo_server_state(self, container):
        """`running`, `exited:<code>`, `absent`, ou `unknown` quand Docker ne répond pas à temps.

        Un `docker exec` expiré sous un Docker chargé ne prouve pas qu'Odoo est arrêté :
        le confondre avec un arrêt faisait échouer des démarrages qui aboutissaient.
        """
        code, output = self.capture(self.docker("exec", container, "sh", "-c", ODOO_SERVER_STATE_SCRIPT), timeout=15)
        if code == 0:
            for line in (output or "").splitlines():
                if line.startswith(ODOO_STATE_MARKER):
                    return line[len(ODOO_STATE_MARKER) :].strip()
        if code == 124:
            return "unknown"
        status = self.container_status(container)
        return "unknown" if status == "running" else "absent"

    def odoo_stopped_error(self, container, state, when, log=None):
        outputs = self.odoo_startup_diagnostics(container, log=log)
        exit_code = state.split(":", 1)[1].strip() if state.startswith("exited:") else ""
        reason = self.odoo_startup_failure_reason(outputs)
        return OdooError(
            f"Le processus Odoo s'est arrêté{f' (code {exit_code})' if exit_code else ''} {when}. {reason}"
        )

    def odoo_startup_failure_reason(self, outputs):
        """Dernière erreur du lancement en cours, sans reprendre celles des démarrages précédents."""
        startup = (outputs.get(ODOO_STARTUP_LOG) or "").splitlines()
        odoo_log = (outputs.get(ODOO_LOG_FILE) or "").splitlines()
        banners = [index for index, line in enumerate(odoo_log) if "odoo: Odoo version" in line]
        current_run = odoo_log[banners[-1] :] if banners else []
        for lines in (current_run, startup):
            reason = self.odoo_command_failure_reason(lines)
            if reason.startswith("Dernière erreur Odoo"):
                return reason
        tail = next((line.strip() for line in reversed(startup) if line.strip() and "security risk" not in line), "")
        if tail:
            return f"Dernière sortie Odoo : {tail[:350]}"
        return "Consulte les logs Odoo affichés ci-dessus."

    def odoo_startup_diagnostics(self, container, log=None):
        commands = (
            (
                "Résultat du dernier lancement Odoo:",
                self.docker(
                    "exec",
                    container,
                    "sh",
                    "-lc",
                    f"test -f {ODOO_STARTUP_STATUS} && cat {ODOO_STARTUP_STATUS} || true",
                ),
                8,
                ODOO_STARTUP_STATUS,
            ),
            (
                "Sortie du dernier lancement Odoo:",
                self.docker(
                    "exec",
                    container,
                    "sh",
                    "-lc",
                    f"tail -n 160 {ODOO_STARTUP_LOG} 2>/dev/null || true",
                ),
                12,
                ODOO_STARTUP_LOG,
            ),
            (
                "Processus dans le conteneur Odoo:",
                self.docker(
                    "exec",
                    container,
                    "sh",
                    "-lc",
                    "ps -eo pid,args | grep -E '[o]doo|[p]ython' | tail -n 30 || true",
                ),
                8,
                "processes",
            ),
            (
                "Derniers logs Odoo:",
                self.docker(
                    "exec",
                    container,
                    "sh",
                    "-lc",
                    f"tail -n 120 {ODOO_LOG_FILE} 2>/dev/null || true",
                ),
                12,
                ODOO_LOG_FILE,
            ),
            (
                "Derniers logs du conteneur Odoo:",
                self.docker("logs", "--tail", "80", container),
                12,
                "container",
            ),
        )
        outputs = {}
        for title, command, timeout, key in commands:
            code, output = self.capture(command, timeout=timeout)
            if code == 0 and output:
                outputs[key] = output
                self.log(log, title)
                self.log(log, output)
        return outputs

    def wait_odoo_port(self, container, max_wait=300, log=None, sleep=None, launch=None):
        """Attend l'ouverture du port 8069.

        `launch` est fourni quand le serveur semblait déjà démarré : s'il n'existe plus, il est lancé
        au lieu de conclure à un arrêt d'un serveur que le gestionnaire n'a jamais démarré.
        """
        sleep = sleep or jobs.sleep
        waited = 0
        missing_since = None
        state = ""
        command = "import socket; s=socket.create_connection(('127.0.0.1', 8069), 2); s.close()"
        while waited <= max_wait:
            if waited == 0 or waited % 10 == 0:
                self.log(log, f"Attente serveur Odoo... {waited}s/{max_wait}s")
            code, _ = self.capture(self.docker("exec", container, "python3", "-c", command), timeout=5)
            if code == 0:
                return
            if waited >= 4:
                state = self.odoo_server_state(container)
                if state in {"running", "unknown"}:
                    missing_since = None
                elif launch is not None:
                    self.log(log, f"Aucun serveur Odoo actif dans {container} : lancement du serveur...")
                    launch()
                    launch = None
                    missing_since = None
                elif state.startswith("exited:"):
                    raise self.odoo_stopped_error(container, state, "avant d'ouvrir le port 8069", log=log)
                else:
                    missing_since = waited if missing_since is None else missing_since
                    if waited - missing_since >= ODOO_PROCESS_GRACE_SECONDS:
                        raise self.odoo_stopped_error(container, state, "avant d'ouvrir le port 8069", log=log)
            sleep(2)
            waited += 2
        self.odoo_startup_diagnostics(container, log=log)
        if state == "unknown":
            raise RuntimeError(
                f"Docker ne répond pas assez vite pour vérifier Odoo dans {container} depuis {max_wait}s. "
                "Vérifie la charge de Docker Desktop (mémoire, CPU), puis relance le démarrage."
            )
        raise RuntimeError(
            f"Odoo fonctionne mais ne répond pas sur le port 8069 après {max_wait}s. "
            "Consulte les logs Odoo affichés ci-dessus."
        )

    def wait_odoo_http(self, container, max_wait=600, request_timeout=45, log=None, sleep=None):
        """Attend une vraie réponse HTTP d'Odoo, sans passer par Traefik.

        Le port 8069 s'ouvre avant le chargement des modules : la première page peut
        ensuite prendre plusieurs minutes (Windows, fichiers sur NTFS, gros projets).
        Tester seulement le port faisait accuser Traefik d'une lenteur d'Odoo.
        """
        sleep = sleep or jobs.sleep
        started = time.monotonic()
        attempt = 0
        missing_since = None
        while True:
            waited = int(time.monotonic() - started)
            code, output = self.capture(
                self.docker("exec", container, "python3", "-c", ODOO_HTTP_READY_SCRIPT, str(request_timeout)),
                timeout=request_timeout + 15,
            )
            if code == 0:
                if attempt:
                    self.log(log, f"Odoo répond dans son conteneur ({waited}s).")
                return
            detail = (output or "").strip().splitlines()[-1:] or ["sans réponse"]
            if attempt == 0:
                self.log(log, "Chargement d'Odoo : attente de la première réponse HTTP dans le conteneur...")
            self.log(log, f"Chargement d'Odoo... {waited}s/{max_wait}s ({detail[0]})")
            attempt += 1
            if detail[0].startswith("HTTP 5"):
                self.raise_for_registry_failure(container, log=log)
            state = self.odoo_server_state(container)
            if state in {"running", "unknown"}:
                missing_since = None
            else:
                missing_since = waited if missing_since is None else missing_since
                if state.startswith("exited:") or waited - missing_since >= ODOO_PROCESS_GRACE_SECONDS:
                    raise self.odoo_stopped_error(container, state, "pendant son chargement", log=log)
            if waited >= max_wait:
                self.odoo_startup_diagnostics(container, log=log)
                raise RuntimeError(
                    f"Odoo ne répond pas en HTTP dans son conteneur après {max_wait}s : le serveur tourne mais "
                    "le chargement des modules n'aboutit pas. Consulte les logs Odoo affichés ci-dessus."
                )
            sleep(3)

    def odoo_current_run_lines(self, container, tail=600):
        """Lignes du journal Odoo écrites depuis le dernier lancement du serveur."""
        code, output = self.capture(
            self.docker("exec", container, "sh", "-c", f"tail -n {tail} {ODOO_LOG_FILE} 2>/dev/null || true"),
            timeout=12,
        )
        if code != 0:
            return []
        lines = output.splitlines()
        banners = [index for index, line in enumerate(lines) if "odoo: Odoo version" in line]
        return lines[banners[-1] :] if banners else lines

    def raise_for_registry_failure(self, container, log=None):
        """Arrête l'attente quand Odoo échoue à charger la base à chaque requête.

        Une erreur 500 répétée n'est pas une lenteur : attendre dix minutes ne la corrige pas. Un
        paquet Python manquant est signalé à part, pour être installé automatiquement.
        """
        lines = self.odoo_current_run_lines(container)
        failures = [index for index, line in enumerate(lines) if "Failed to load registry" in line]
        if not failures:
            return
        last_failure = lines[max(failures[-1] - 60, 0) :]
        reason = self.odoo_command_failure_reason(last_failure)
        import_name = missing_python_import("\n".join(last_failure))
        if import_name:
            raise MissingPythonDependency(import_name, reason)
        if len(failures) >= REGISTRY_FAILURES_BEFORE_ABORT:
            self.odoo_startup_diagnostics(container, log=log)
            raise OdooError(f"Odoo n'arrive pas à ouvrir la base ({len(failures)} essais). {reason}")

    @staticmethod
    def http_probe_result(url, timeout=10):
        """Retourne (statut HTTP, cause) ; la cause distingue les échecs de connexion."""
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname
        if not host:
            return 0, "url"
        connect_host = host if host in {"127.0.0.1", "localhost", "::1"} else "127.0.0.1"
        connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_class(connect_host, parsed.port, timeout=timeout)
        try:
            path = parsed.path or "/"
            if parsed.query:
                path += f"?{parsed.query}"
            host_header = host if parsed.port in {None, 80, 443} else f"{host}:{parsed.port}"
            connection.request(
                "GET",
                path,
                headers={"Host": host_header, "User-Agent": "Odoo-Manager/readiness"},
            )
            return connection.getresponse().status, ""
        except ConnectionRefusedError:
            return 0, "refused"
        except (ConnectionResetError, http.client.RemoteDisconnected):
            return 0, "reset"
        except TimeoutError:
            return 0, "timeout"
        except (OSError, http.client.HTTPException):
            return 0, "error"
        finally:
            connection.close()

    def traefik_route_failure(self, project, status, reason, url=None, problems=None):
        parsed = urllib.parse.urlsplit(url or self.project_url(project))
        host = parsed.hostname or "l'URL locale"
        port = parsed.port or TRAEFIK_DEFAULT_HTTP_PORT
        container = f"odoo-{project}"
        if reason in {"refused", "reset"}:
            name = self.traefik_container_name()
            traefik = self.container_status(name)
            return (
                f"Rien n'écoute sur le port {port} de cette machine (conteneur {name} : {traefik}). "
                f"Traefik est arrêté, ou le port {port} est occupé par un autre service "
                "(sous Windows : IIS, service HTTP « System », Skype...). Odoo, lui, fonctionne."
            )
        if status == 404:
            if problems is None:
                problems = self.traefik_route_problems(project, port)
            if problems:
                return f"{host} répond en HTTP 404 sur le port {port} : {'; '.join(problems)}."
            networks = self.container_network_names(container)
            network_hint = (
                f" Le conteneur n'est pas relié au réseau traefik-local (réseaux : {', '.join(networks) or 'aucun'})."
                if "traefik-local" not in networks
                else " Vérifie les labels traefik du docker-compose.yml."
            )
            return f"Traefik répond mais ne connaît pas la route {host} pour {container}.{network_hint}"
        if status in {502, 503, 504}:
            return (
                f"Traefik connaît la route {host} mais n'arrive pas à joindre {container}:8069 (HTTP {status}). "
                "Vérifie que Traefik et le projet partagent le réseau traefik-local."
            )
        if reason == "timeout":
            return (
                f"Odoo répond dans son conteneur, mais les requêtes vers {host} via Traefik dépassent le délai. "
                "Réessaie d'ouvrir le projet dans quelques secondes."
            )
        return f"Odoo répond dans son conteneur, mais {host} reste inaccessible via Traefik ({reason or status})."

    def traefik_route_problems(self, project, port):
        """Causes certaines d'un 404 persistant : attendre plus longtemps ne les corrigera pas."""
        instances = self.traefik_instances()
        if instances is None:
            return []
        instance = select_traefik_instance(instances, self.is_managed_traefik)
        self.use_traefik_instance(instance)
        if instance is None or not instance.running:
            return [f"aucun conteneur Traefik n'est démarré, un autre serveur web occupe le port {port}"]
        if instance.http_port and instance.http_port != port:
            return [
                f"Traefik ({instance.describe()}) n'écoute pas sur le port {port}, un autre serveur web occupe ce port"
            ]
        problems = [f"Traefik ({instance.describe()}) : {problem}" for problem in instance.compatibility_problems()]
        container = f"odoo-{project}"
        networks = self.container_network_names(container)
        if (
            networks
            and instance.on_project_network
            and not instance.host_network
            and not set(networks) & set(instance.networks)
        ):
            problems.append(
                f"{container} (réseaux : {', '.join(networks)}) ne partage aucun réseau avec {instance.name} "
                f"(réseaux : {', '.join(instance.networks)})"
            )
        missing = self.missing_traefik_middlewares(instance)
        if missing:
            problems.append(
                f"aucun conteneur ne définit les middlewares {', '.join(name + '@docker' for name in missing)} "
                "utilisés par les routes du projet (le Traefik de docker-local-tools les déclare)"
            )
        return problems

    def container_network_names(self, container):
        code, output = self.capture(
            self.docker(
                "inspect",
                "-f",
                "{{range $name, $network := .NetworkSettings.Networks}}{{$name}}|{{$network.NetworkID}};{{end}}",
                container,
            ),
            timeout=5,
        )
        if code != 0:
            return []
        return [item.split("|", 1)[0] for item in output.split(";") if item.strip()]

    def wait_project_http(self, project, max_wait=90, log=None, sleep=None):
        sleep = sleep or jobs.sleep
        url = urllib.parse.urljoin(self.project_url(project), "web/login")
        if self.runner is not None and self.http_probe is None:
            return

        waited = 0
        last_display = None
        status, reason = 0, ""
        port_repair_attempted = False
        route_diagnosed = False
        port_rechecked = False
        problems = None
        while waited <= max_wait:
            result = self.http_probe(url) if self.http_probe else self.http_probe_result(url)
            status, reason = result if isinstance(result, tuple) else (result, "")
            port = urllib.parse.urlsplit(url).port or TRAEFIK_DEFAULT_HTTP_PORT
            display = (
                f"HTTP {status}" if status else HTTP_FAILURE_LABELS.get(reason, "HTTP indisponible").format(port=port)
            )
            if display != last_display or waited % 10 == 0:
                self.log(log, f"Vérification de l'accès Odoo via Traefik... {waited}s/{max_wait}s ({display})")
                last_display = display
            if 200 <= status < 500 and status != 404:
                return

            certain_failure = False
            if reason in {"refused", "reset"} and waited >= 4 and not port_repair_attempted:
                port_repair_attempted = True
                if not self.ensure_traefik_port_reachable(log=log, sleep=sleep):
                    # Traefik arrêté : personne ne le redémarrera pendant l'attente. S'il tourne,
                    # la redirection de Docker Desktop peut encore revenir : on continue d'attendre.
                    certain_failure = self.container_status(self.traefik_container_name()) != "running"
                    certain_failure = certain_failure or self.traefik_http_port(refresh=True) != port
            if status == 404 and waited >= TRAEFIK_ROUTE_DIAGNOSIS_SECONDS and not route_diagnosed:
                route_diagnosed = True
                problems = self.traefik_route_problems(project, port)
                certain_failure = bool(problems)
            if certain_failure:
                # Traefik a pu être démarré sur un autre port que celui de l'URL : une seule nouvelle détection.
                detected = urllib.parse.urljoin(self.project_url(project, refresh_traefik=True), "web/login")
                if detected != url and not port_rechecked:
                    port_rechecked = True
                    self.log(log, f"Traefik détecté sur un autre port : vérification de {detected}")
                    url = detected
                    route_diagnosed = False
                    problems = None
                    continue
                raise RuntimeError(
                    self.traefik_route_failure(project, status, reason, url=url, problems=problems)
                    + " Le navigateur n'a pas été ouvert afin d'éviter une page Bad Gateway."
                )
            sleep(2)
            waited += 2
        raise RuntimeError(
            self.traefik_route_failure(project, status, reason, url=url)
            + " Le navigateur n'a pas été ouvert afin d'éviter une page Bad Gateway."
        )

    def start_odoo_server(self, project, log=None, disable_cron=False, sleep=None):
        sleep = sleep or jobs.sleep
        container = f"odoo-{project}"

        def launch():
            mode = " sans workers cron" if disable_cron else ""
            self.log(log, f"Démarrage du serveur Odoo{mode} dans {container}...")
            cron_option = " --max-cron-threads=0" if disable_cron else ""
            launch_command = (
                f"rm -f {ODOO_STARTUP_STATUS}; "
                f": > {ODOO_STARTUP_LOG}; "
                "if [ -x /home/_venv/bin/python ] && "
                "[ -f /home/odoo/srv/server/odoo/odoo-bin ]; then "
                "/home/_venv/bin/python /home/odoo/srv/server/odoo/odoo-bin "
                "-c /home/odoo/srv/conf/odoo.conf "
                f"--logfile=/home/odoo/srv/data/odoo.log{cron_option}; "
                "else "
                "odoo -c /home/odoo/srv/conf/odoo.conf "
                f"--logfile=/home/odoo/srv/data/odoo.log{cron_option}; "
                "fi "
                f">> {ODOO_STARTUP_LOG} 2>&1; "
                "code=$?; "
                f"printf '%s\\n' \"$code\" > {ODOO_STARTUP_STATUS}; "
                'exit "$code"'
            )
            code = self.stream(
                self.docker(
                    "exec",
                    "-e",
                    "LOG_ATTACHMENTS=False",
                    "-d",
                    container,
                    "sh",
                    "-lc",
                    launch_command,
                ),
                log=log,
            )
            if code != 0:
                raise RuntimeError("Impossible de démarrer le serveur Odoo dans le conteneur.")

        state = self.odoo_server_state(container)
        for _ in range(3):
            # Docker chargé : réessayer avant de lancer un second serveur à l'aveugle.
            if state != "unknown":
                break
            sleep(2)
            state = self.odoo_server_state(container)
        if state == "running":
            self.log(log, f"Serveur Odoo déjà démarré dans {container}")
            self.wait_odoo_port(container, log=log, sleep=sleep, launch=launch)
        else:
            launch()
            self.wait_odoo_port(container, log=log, sleep=sleep)
        installed = []
        while True:
            try:
                self.wait_odoo_http(container, log=log, sleep=sleep)
                return
            except MissingPythonDependency as exc:
                if exc.package in installed or len(installed) >= MAX_AUTOMATIC_PYTHON_INSTALLS:
                    raise
                installed.append(exc.package)
                self.log(log, f"Un module de la base a besoin du paquet Python {exc.package}, absent du conteneur.")
                self.install_python_package(project, exc.package, log=log)
                self.stop_odoo_server(project, log=log, sleep=sleep)
                launch()
                self.wait_odoo_port(container, log=log, sleep=sleep)

    def restart_odoo_server_after_failure(self, project, log=None):
        """Relance Odoo sans masquer l'erreur de l'opération qui a échoué."""
        self.log(log, "Redémarrage du serveur Odoo...")
        try:
            self.start_odoo_server(project, log=log)
        except Exception as exc:
            self.log(log, f"Redémarrage du serveur Odoo impossible : {exc}")

    def stop_odoo_server(self, project, log=None, max_wait=30, sleep=None):
        sleep = sleep or jobs.sleep
        container = f"odoo-{project}"
        # État inconnu (Docker lent) : l'arrêt est tenté, une commande module ne doit pas croiser un serveur actif.
        if self.odoo_server_state(container) not in {"running", "unknown"}:
            return
        if self.odoo_is_container_command(container):
            # Tuer ce processus arrêterait tout le conteneur : il est recréé sans lancer Odoo.
            if self.detach_odoo_from_container_command(project, log=log):
                self.wait_for_container(container, log=log, sleep=sleep)
                self.wait_for_odoo_container_initialization(container, log=log, sleep=sleep)
            if self.odoo_is_container_command(container):
                raise RuntimeError(
                    "Odoo est lancé par le conteneur du projet lui-même : l'arrêter arrêterait tout le projet. "
                    f"Retire la ligne « command: » du service {container} dans les fichiers compose du projet, "
                    "puis redémarre le projet."
                )
            return
        self.log(log, f"Arrêt du serveur Odoo dans {container}...")
        code = self.stream(
            self.docker(
                "exec",
                container,
                "sh",
                "-lc",
                "pkill -TERM -f '[o]doo-bin' || pkill -TERM -f '[ /]odoo ' || true",
            ),
            log=log,
        )
        if code != 0:
            raise RuntimeError("Impossible d'arrêter le serveur Odoo avant l'opération module.")
        waited = 0
        while waited <= max_wait:
            if self.odoo_server_state(container) not in {"running", "unknown"}:
                return
            sleep(1)
            waited += 1
        raise RuntimeError("Le serveur Odoo ne s'est pas arrêté dans le délai prévu.")

    def odoo_is_container_command(self, container):
        """Vrai quand Odoo est le processus principal du conteneur : l'arrêter arrête le conteneur."""
        code, command = self.capture(
            self.docker("exec", container, "sh", "-lc", CONTAINER_MAIN_PROCESS_SCRIPT), timeout=8
        )
        return code == 0 and re.match(ODOO_SERVER_PROCESS_PATTERN, command.strip()) is not None

    def detach_odoo_from_container_command(self, project, log=None):
        """Retire du compose le `command:` qui lance Odoo et recrée le conteneur Odoo sans lui.

        Le gestionnaire lance ensuite Odoo lui-même, et peut l'arrêter sans arrêter le conteneur.
        Retourne False si le compose n'a pas ce `command:`.
        """
        compose = self.compose_file(project)
        if not compose:
            return False
        try:
            content = compose.read_text(encoding="utf-8")
        except OSError:
            return False
        updated, service = remove_odoo_container_command(content, f"odoo-{project}")
        if not service:
            return False
        backup = compose.with_name(f"{compose.name}.command.bak.{time.strftime('%Y%m%d_%H%M%S')}")
        shutil.copy2(compose, backup)
        compose.write_text(updated, encoding="utf-8")
        self.log(
            log,
            f"Odoo était lancé par le conteneur lui-même (« command: » de {service} dans {compose.name}) : "
            "l'arrêter arrêtait tout le conteneur. Ligne retirée, le gestionnaire lance désormais Odoo.",
        )
        self.log(log, f"Sauvegarde: {backup}")
        self.log(log, "Recréation du conteneur Odoo (bases, filestores et code conservés)...")
        code = self.stream(
            self.docker("compose", "up", "-d", "--no-deps", service), cwd=self.project_path(project), log=log
        )
        if code != 0:
            # Le conteneur d'origine tourne toujours : le compose doit continuer de le décrire.
            compose.write_text(content, encoding="utf-8")
            raise RuntimeError("Impossible de recréer le conteneur Odoo du projet.")
        return True

    def install_project_pip_requirements(self, project, log=None):
        requirements = self.project_path(project) / "init" / "requirements_pip.txt"
        try:
            has_requirements = any(
                line.strip() and not line.lstrip().startswith("#")
                for line in requirements.read_text(encoding="utf-8", errors="ignore").splitlines()
            )
        except FileNotFoundError:
            return
        except OSError as exc:
            raise RuntimeError(f"Impossible de lire {requirements}: {exc}") from exc
        if not has_requirements:
            return
        self.log(log, "Vérification des dépendances Python du projet...")
        code = self.stream(
            self.docker(
                "exec",
                f"odoo-{project}",
                "/home/_venv/bin/python",
                "-m",
                "pip",
                "install",
                "-r",
                "/home/odoo/srv/conf/requirements_pip.txt",
            ),
            log=log,
        )
        if code != 0:
            raise RuntimeError("L'installation des dépendances Python du projet a échoué.")

    def record_python_requirement(self, project, package, log=None):
        """Ajoute `package` à requirements_pip.txt : persiste ce que l'auto-installation vient de
        déduire d'une erreur Odoo, pour que les prochains conteneurs l'aient sans reproduire l'échec."""
        requirements = self.project_path(project) / "init" / "requirements_pip.txt"
        try:
            content = requirements.read_text(encoding="utf-8", errors="ignore")
        except FileNotFoundError:
            content = ""
        existing = {line.strip() for line in content.splitlines() if line.strip() and not line.lstrip().startswith("#")}
        if package in existing:
            return
        requirements.parent.mkdir(parents=True, exist_ok=True)
        separator = "" if not content or content.endswith("\n") else "\n"
        requirements.write_text(f"{content}{separator}{package}\n", encoding="utf-8")
        self.log(log, f"{package} ajouté à init/requirements_pip.txt")

    def missing_python_modules(self, project, names):
        """Parmi `names`, ceux que l'interpréteur d'Odoo ne trouve pas."""
        names = [name for name in names if re.fullmatch(r"[\w.\-]+", name)]
        if not names:
            return []
        code, output = self.capture(
            self.docker(
                "exec",
                f"odoo-{project}",
                "sh",
                "-c",
                ODOO_PYTHON_PREFIX + 'exec "$py" -c "$0" "$@"',
                MISSING_PYTHON_MODULES_SCRIPT,
                *names,
            ),
            timeout=60,
        )
        if code != 0:
            raise RuntimeError(f"Vérification des paquets Python impossible dans odoo-{project} : {output[-300:]}")
        found = {line.strip() for line in output.splitlines() if line.strip()}
        return [name for name in names if name in found]

    def install_python_package(self, project, package, log=None):
        """Installe `package` pour l'interpréteur d'Odoo et le note dans init/requirements_pip.txt."""
        if not re.fullmatch(r"[A-Za-z0-9][\w.\-]*", package):
            raise ValueError(f"Nom de paquet Python invalide : {package}")
        self.log(log, f"Installation du paquet Python {package} dans odoo-{project}...")
        code = self.stream(
            self.docker(
                "exec",
                f"odoo-{project}",
                "sh",
                "-c",
                ODOO_PYTHON_PREFIX + 'exec "$py" -m pip install --disable-pip-version-check "$0"',
                package,
            ),
            log=log,
        )
        if code != 0:
            raise RuntimeError(
                f"Le paquet Python « {package} » n'a pas pu être installé dans le conteneur Odoo (réseau, nom de "
                "paquet différent…). Ajoute-le à init/requirements_pip.txt à la racine du projet, puis redémarre."
            )
        self.record_python_requirement(project, package, log=log)

    def ensure_python_dependencies(self, project, db_name, graph, log=None):
        """Installe les paquets Python déclarés par les modules installés de la base et absents du conteneur.

        Sans eux, Odoo n'ouvre pas la base : chaque page répond en erreur 500.
        Retourne les paquets installés.
        """
        installed = [line for line in self._postgres_lines(project, db_name, database_restore.INSTALLED_MODULES_SQL)]
        wanted = sorted(
            {
                dependency
                for module in installed
                for dependency in (graph.get(module) or {}).get("python_dependencies", ())
            }
        )
        missing = self.missing_python_modules(project, wanted)
        packages = []
        for name in missing:
            package = python_package_for_import(name)
            self.log(log, f"Paquet Python demandé par les modules de {db_name} et absent : {package}")
            self.install_python_package(project, package, log=log)
            packages.append(package)
        return packages

    def _postgres_lines(self, project, db_name, query, timeout=30):
        code, output = self.capture(
            self.docker(
                "exec",
                f"postgresql-{project}",
                "psql",
                "-X",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "postgres",
                "-d",
                db_name,
                "-Atc",
                query,
            ),
            timeout=timeout,
        )
        if code != 0:
            raise RuntimeError(output.strip()[-500:] or f"Requête PostgreSQL refusée sur {db_name}.")
        return [line.strip() for line in output.splitlines() if line.strip()]

    def run_postgres_sql(self, project, db_name, sql, timeout=120):
        """Exécute `sql` en superutilisateur, d'un seul bloc ; échoue à la première erreur."""
        return self._postgres_lines(project, db_name, sql, timeout=timeout)

    def odoo_database_user(self, project):
        """Rôle PostgreSQL d'Odoo (db_user de odoo.conf) : les tables du dump doivent lui appartenir."""
        try:
            content = (self.project_path(project) / "odoo.conf").read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return "odoo"
        match = re.search(r"(?m)^\s*db_user\s*=\s*([^\s#;]+)", content)
        return match.group(1) if match else "odoo"

    def container_free_bytes(self, container, path):
        """Espace libre vu depuis le conteneur (dossier monté ou volume Docker), None s'il est illisible."""
        code, output = self.capture(self.docker("exec", container, "sh", "-c", f'df -Pk "{path}"'), timeout=15)
        return database_restore.parse_df_available(output) if code == 0 else None

    def docker_resources(self, refresh=False):
        """(mémoire en octets, processeurs) dont dispose Docker ; (0, 0) s'il ne répond pas."""
        key = tuple(self.docker())
        with DOCKER_RESOURCES_LOCK:
            cached = DOCKER_RESOURCES_CACHE.get(key)
        if cached and not refresh and time.monotonic() - cached[0] < DOCKER_RESOURCES_TTL_SECONDS:
            return cached[1]
        code, output = self.capture(self.docker("info", "--format", "{{.MemTotal}} {{.NCPU}}"), timeout=20)
        parts = output.split() if code == 0 else []
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            resources = int(parts[0]), int(parts[1])
            with DOCKER_RESOURCES_LOCK:
                DOCKER_RESOURCES_CACHE[key] = (time.monotonic(), resources)
            return resources
        return 0, 0

    def tune_postgres(self, project, log=None):
        """Règle le PostgreSQL du projet d'après la mémoire et les processeurs de Docker.

        Les réglages sont écrits par ALTER SYSTEM et rechargés à chaud ; la mémoire partagée exige
        un redémarrage de PostgreSQL, fait seulement quand le serveur Odoo est arrêté. Réglage
        désactivé dans les paramètres : les valeurs posées par le gestionnaire sont retirées.
        Retourne True si quelque chose a changé.
        """
        rows = self._postgres_lines(project, "postgres", POSTGRES_AUTO_SETTINGS_SQL)
        current = dict(row.split("|", 1) for row in rows if "|" in row)
        wanted = {}
        if getattr(self.settings, "tune_postgres", True):
            memory, cpus = self.docker_resources()
            wanted = performance.postgres_settings(memory, cpus, self.postgres_server_version(project))
        changes = [(name, value) for name, value in wanted.items() if current.get(name) != value]
        resets = [name for name in performance.POSTGRES_TUNED_SETTINGS if name in current and name not in wanted]
        if changes or resets:
            statements = [
                *(f"ALTER SYSTEM SET {name} = {database_restore.sql_literal(value)};" for name, value in changes),
                *(f"ALTER SYSTEM RESET {name};" for name in resets),
                "SELECT pg_reload_conf();",
            ]
            arguments = []
            for statement in statements:
                # ALTER SYSTEM refuse de s'exécuter dans une transaction : une commande -c chacun.
                arguments.extend(["-c", statement])
            code, output = self.capture(
                self.docker(
                    "exec",
                    f"postgresql-{project}",
                    "psql",
                    "-X",
                    "-q",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-U",
                    "postgres",
                    *arguments,
                ),
                timeout=30,
            )
            if code != 0:
                raise RuntimeError(output.strip()[-400:] or "Réglages PostgreSQL refusés.")
            if wanted:
                self.log(
                    log, "PostgreSQL réglé pour cet ordinateur : " + performance.describe_postgres_settings(wanted)
                )
            else:
                self.log(log, "Réglages PostgreSQL du gestionnaire retirés : valeurs par défaut rétablies.")
        pending = self._postgres_lines(project, "postgres", "SELECT count(*) FROM pg_settings WHERE pending_restart;")
        if pending and pending[0] != "0":
            if self.odoo_server_state(f"odoo-{project}") in {"running", "unknown"}:
                self.log(log, "Le nouveau cache de PostgreSQL s'appliquera au prochain démarrage du projet.")
            else:
                self.log(log, "Redémarrage de PostgreSQL pour appliquer son nouveau cache...")
                if self.stream(self.docker("restart", f"postgresql-{project}"), log=log) != 0:
                    raise RuntimeError("Redémarrage de PostgreSQL impossible.")
                self.wait_for_postgres(project, log=log)
        return bool(changes or resets)

    def postgres_server_version(self, project):
        lines = self._postgres_lines(project, "postgres", "SHOW server_version_num;")
        return int(lines[0]) if lines and lines[0].isdigit() else 0

    def create_restore_database(self, project, db_name, extensions=(), log=None):
        """Crée la base vide qui reçoit le dump, comme Odoo, avec les extensions qu'il demande.

        Les extensions sont créées par le superutilisateur : le rôle d'Odoo n'en a pas le droit
        (pgvector notamment), et sans elles psql perd les tables qui en dépendent.
        """
        owner = self.odoo_database_user(project)
        self.log(log, f"Création de la base vide {db_name} (propriétaire {owner})...")
        self.run_postgres_sql(project, "postgres", database_restore.create_database_sql(db_name, owner))
        for extension in database_restore.ODOO_BASE_EXTENSIONS:
            self.create_postgres_extension(project, db_name, extension, log=log)
        for extension in extensions:
            if extension in database_restore.ODOO_BASE_EXTENSIONS:
                continue
            try:
                self.create_postgres_extension(project, db_name, extension, log=log)
            except RuntimeError as exc:
                # Odoo poursuivrait sans elle : seules les tables qui en dépendent manqueront.
                self.log(log, f"Attention : {exc} Les tables qui en dépendent ne seront pas restaurées.")
        try:
            # Odoo rend unaccent immuable pour l'utiliser dans ses index ; seul le superutilisateur le peut.
            self.run_postgres_sql(project, db_name, "ALTER FUNCTION unaccent(text) IMMUTABLE;")
        except RuntimeError:
            pass

    def load_database_dump(self, project, db_name, archive, entry, options="", log=None, on_post_data=None):
        """Envoie dump.sql du ZIP à psql dans le conteneur PostgreSQL, sans rien décompresser sur disque.

        Retourne le nombre d'erreurs signalées par psql (Odoo les ignore aussi).
        """
        errors = database_restore.PsqlErrors(log=log)
        total = entry.file_size

        def progress(sent, size, step):
            if tracker.post_data:
                # Les index se construisent sur quelques Mo de texte : la barre avance alors avec le temps.
                return
            job_progress.measure(sent, size)
            if step is not None:
                self.log(
                    log,
                    f"Chargement des données... {step} % ({database_restore.format_bytes(sent)} "
                    f"sur {database_restore.format_bytes(size)})",
                )

        tracker = database_restore.DumpProgress(total, on_progress=progress, on_post_data=on_post_data)
        command = self.docker(
            "exec",
            "-i",
            "-e",
            f"PGOPTIONS={options}",
            f"postgresql-{project}",
            "psql",
            "-X",
            "-q",
            "-U",
            self.odoo_database_user(project),
            "-d",
            db_name,
        )

        def produce(stdin):
            database_restore.stream_dump(archive, entry, stdin.write, tracker)

        code = self.feed_process(command, produce, log=log, on_error_line=errors.add)
        if code != 0:
            detail = f" Dernière erreur : {errors.lines[-1]}" if errors.lines else ""
            raise RuntimeError(
                f"Le chargement de la base s'est arrêté avant la fin (psql, code {code}).{detail} "
                "Vérifie l'espace disque et la mémoire allouée à Docker, puis relance la restauration."
            )
        if errors.count > errors.LIMIT:
            self.log(log, f"... {errors.count - errors.LIMIT} autre(s) erreur(s) psql non affichée(s).")
        return errors.count

    def restore_filestore(self, project, db_name, archive, entries, log=None):
        """Copie le filestore de l'archive dans le conteneur Odoo, en flux tar."""
        target = f"{ODOO_DATA_DIR}/filestore/{db_name}"
        total = len(entries)
        step = max(total // 10, 1)

        def on_file(index, count):
            job_progress.measure(index, count)
            if index % step == 0 or index == count:
                self.log(log, f"Copie du filestore... {index}/{count} fichier(s)")

        command = self.docker(
            "exec",
            "-i",
            "-e",
            f"TARGET={target}",
            f"odoo-{project}",
            "sh",
            "-c",
            'mkdir -p "$TARGET" && exec tar -x -m -C "$TARGET"',
        )
        lines = []
        code = self.feed_process(
            command,
            lambda stdin: database_restore.write_filestore_tar(archive, entries, stdin, on_file=on_file),
            log=log,
            on_error_line=lines.append,
        )
        if code != 0:
            raise RuntimeError(
                f"Copie du filestore ({total} fichier(s)) interrompue : {' '.join(lines)[-300:] or f'code {code}'}"
            )

    def free_space_from_restore_leftovers(self, project, log=None):
        """Après un démarrage manqué : démarre seul le conteneur Odoo pour supprimer ces restes.

        Retourne True si de la place a été libérée, donc si un nouvel essai a une chance d'aboutir.
        """
        container = f"odoo-{project}"
        status = self.container_status(container)
        if status in {"exited", "created"}:
            # `docker start` ignore la dépendance à PostgreSQL : le nettoyage n'a besoin que de ce conteneur.
            if self.capture(self.docker("start", container), timeout=60)[0] != 0:
                return False
        elif status != "running":
            return False
        return self.remove_odoo_restore_leftovers(project, log=log) > 0

    def remove_odoo_restore_leftovers(self, project, log=None):
        """Supprime du conteneur Odoo les restes d'une restauration interrompue. Retourne les octets libérés."""
        container = f"odoo-{project}"
        code, output = self.capture(
            self.docker("exec", container, "sh", "-c", ODOO_RESTORE_LEFTOVERS_SCRIPT), timeout=300
        )
        if code != 0:
            return 0
        freed = 0
        for line in output.splitlines():
            parts = line.split(" ", 2)
            if len(parts) == 3 and parts[0] == "removed" and parts[1].isdigit():
                freed += int(parts[1]) * 1024
        if freed:
            self.log(
                log,
                "Fichiers temporaires d'une ancienne restauration interrompue supprimés du conteneur Odoo "
                f"({database_restore.format_bytes(freed)} libérés).",
            )
        return freed

    def create_postgres_extension(self, project, db_name, extension, log=None):
        """Installe une extension PostgreSQL manquante via le rôle `postgres`, superuser du conteneur.

        Certains modules (ex. pgvector pour l'IA) exigent CREATE EXTENSION, que le rôle applicatif
        `odoo` n'a délibérément pas (privilège minimal, cf. retry_docker_desktop_macos_postgres_bootstrap).
        Une fois créée, l'extension reste acquise pour cette base : plus jamais besoin d'y revenir.
        """
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", extension):
            raise ValueError(f"Nom d'extension PostgreSQL invalide : {extension}")
        self.log(log, f"Installation de l'extension PostgreSQL {extension} (rôle postgres)...")
        code, output = self.run_create_postgres_extension(project, db_name, extension)
        if code != 0 and extension == "vector" and POSTGRES_EXTENSION_UNAVAILABLE_RE.search(output):
            # Projet créé avant que son modèle ne passe à l'image pgvector : l'image officielle
            # n'a pas l'extension, aucun droit ne la fera apparaître.
            self.log(log, output.strip())
            if not self.switch_postgres_to_pgvector_image(project, log=log):
                raise RuntimeError(PGVECTOR_IMAGE_REQUIRED_MESSAGE)
            code, output = self.run_create_postgres_extension(project, db_name, extension)
        if code != 0:
            raise RuntimeError(f"Installation de l'extension PostgreSQL {extension} impossible : {output.strip()}")
        self.log(log, f"Extension PostgreSQL {extension} installée.")

    def run_create_postgres_extension(self, project, db_name, extension):
        return self.capture(
            self.docker(
                "exec",
                f"postgresql-{project}",
                "psql",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "postgres",
                "-d",
                db_name,
                "-c",
                f'CREATE EXTENSION IF NOT EXISTS "{extension}";',
            ),
            timeout=20,
        )

    def switch_postgres_to_pgvector_image(self, project, log=None):
        """Passe le PostgreSQL du projet sur l'image pgvector de même version et recrée son conteneur.

        Les données vivent dans un dossier monté : le nouveau conteneur les reprend telles quelles.
        Un simple redémarrage ne suffirait pas, le démarrage réutilise les conteneurs existants.
        Retourne False si le compose n'utilise pas l'image officielle sous une forme reconnue.
        """
        compose = self.compose_file(project)
        if not compose:
            return False
        try:
            content = compose.read_text(encoding="utf-8")
        except OSError:
            return False
        updated, image, service = use_pgvector_postgres_image(content)
        if not image:
            return False
        backup = compose.with_name(f"{compose.name}.pgvector.bak.{time.strftime('%Y%m%d_%H%M%S')}")
        shutil.copy2(compose, backup)
        compose.write_text(updated, encoding="utf-8")
        self.log(log, f"Image PostgreSQL remplacée par {image} dans {compose.name} (les bases sont conservées).")
        self.log(log, f"Sauvegarde: {backup}")
        code = self.stream(
            self.docker("compose", "up", "-d", "--no-deps", service), cwd=self.project_path(project), log=log
        )
        if code != 0:
            # Image introuvable ou réseau coupé : le conteneur d'origine tourne toujours, le compose
            # doit continuer de le décrire.
            compose.write_text(content, encoding="utf-8")
            raise RuntimeError(f"Impossible de recréer le conteneur PostgreSQL sur l'image {image}.")
        self.wait_for_postgres(project, log=log)
        return True

    def odoo_addons_paths(self, project):
        """Chemins des addons dans le conteneur, lus dans odoo.conf (le module base y est toujours)."""
        try:
            content = (self.project_path(project) / "odoo.conf").read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return []
        match = re.search(r"(?m)^\s*addons_path\s*=\s*(.+)$", content)
        return [path.strip() for path in match.group(1).split(",") if path.strip()] if match else []

    def read_module_data_file(self, project, module, path, addons_paths):
        """Contenu d'un fichier de données d'un module, cherché dans les chemins des addons du conteneur."""
        if not re.fullmatch(r"\w+", module) or not re.fullmatch(r"[\w./-]+", path) or ".." in path.split("/"):
            return None
        script = 'for d in "$@"; do if [ -f "$d/$0" ]; then cat "$d/$0"; exit 0; fi; done; exit 1'
        code, output = self.capture(
            self.docker("exec", f"odoo-{project}", "sh", "-c", script, f"{module}/{path}", *addons_paths),
            timeout=30,
        )
        return output if code == 0 else None

    def adopt_conflicting_records(self, project, db_name, conflict, addons_paths=(), log=None):
        """Rattache au module les enregistrements existants qui bloquent le chargement de ses données.

        Voir odoo_manager_core/data_conflicts.py. Retourne le nombre d'identifiants XML créés.
        """
        paths = list(dict.fromkeys([*addons_paths, *self.odoo_addons_paths(project)]))
        content = self.read_module_data_file(project, conflict.module, conflict.path, paths)
        if content is None:
            self.log(log, f"Fichier {conflict.key} introuvable dans le conteneur : rapprochement impossible.")
            return 0
        model, records = data_conflicts.data_records(conflict, content)
        if not model or not records:
            return 0
        names = ", ".join(data_conflicts.sql_literal(column) for column in conflict.columns)
        types = {}
        for line in self._postgres_lines(
            project,
            db_name,
            "SELECT column_name || '|' || data_type FROM information_schema.columns "
            f"WHERE table_schema = 'public' AND table_name = {data_conflicts.sql_literal(conflict.table)} "
            f"AND column_name IN ({names});",
        ):
            column, _separator, data_type = line.partition("|")
            types[column] = data_type
        if set(types) != set(conflict.columns):
            return 0
        sql = data_conflicts.adoption_sql(conflict, model, records, types)
        if not sql:
            return 0
        adopted = [line for line in self.run_postgres_sql(project, db_name, sql) if "." in line]
        if adopted:
            shown = ", ".join(adopted[:6]) + (f" et {len(adopted) - 6} autre(s)" if len(adopted) > 6 else "")
            self.log(
                log, f"{len(adopted)} enregistrement(s) existant(s) rattaché(s) au module {conflict.module} : {shown}"
            )
        return len(adopted)

    def remove_orphan_report_expressions(self, project, db_name, module, log=None):
        """Supprime les expressions de rapport `balance` d'un module que sa version actuelle recrée.

        Une base créée avec une ancienne version du module porte des expressions d'agrégation sans
        identifiant XML sur les lignes du module. La version actuelle les déclare explicitement :
        Odoo ne les reconnaît pas et échoue sur l'unicité (ligne, libellé). Les supprimer laisse
        Odoo les recréer à l'identique au réessai. Seules les lignes de ce module sont touchées, et
        pas les expressions qui portent des valeurs saisies (ajustements, reports).
        """
        if not re.fullmatch(r"[a-z][a-z0-9_]*", module):
            raise ValueError(f"Nom de module invalide : {module}")
        sql = (
            "DELETE FROM account_report_expression e "
            "USING ir_model_data line_data "
            "WHERE line_data.model = 'account.report.line' AND line_data.res_id = e.report_line_id "
            f"AND line_data.module = '{module}' "
            "AND e.engine = 'aggregation' AND e.label = 'balance' "
            "AND NOT EXISTS (SELECT 1 FROM ir_model_data d "
            "WHERE d.model = 'account.report.expression' AND d.res_id = e.id) "
            "AND NOT EXISTS (SELECT 1 FROM account_report_external_value v "
            "WHERE v.target_report_expression_id = e.id) "
            "RETURNING e.id;"
        )
        code, output = self.capture(
            self.docker(
                "exec",
                f"postgresql-{project}",
                "psql",
                "-X",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "postgres",
                "-d",
                db_name,
                "-Atc",
                sql,
            ),
            timeout=30,
        )
        if code != 0:
            raise RuntimeError(f"Nettoyage des expressions de rapport de {module} impossible : {output.strip()}")
        removed = [line for line in output.splitlines() if line.strip().isdigit()]
        self.log(log, f"{len(removed)} expression(s) de rapport de {module} supprimée(s) : Odoo les recrée au réessai.")
        return len(removed)

    def ensure_odoo_containers_ready(self, project, log=None):
        container = f"odoo-{project}"
        postgres = f"postgresql-{project}"
        if not self.is_running(container) or not self.is_running(postgres):
            self.start_project(project, log=log)
        else:
            self.wait_for_odoo_container_initialization(container, log=log)

    def run_odoo_module_command(self, project, db_name, modules, option="-u", log=None, overwrite_translations=False):
        if option not in {"-i", "-u"}:
            raise ValueError("Option module Odoo invalide.")
        container = f"odoo-{project}"
        job_progress.span("Préparation d'Odoo", share=0.12, expected=20)
        self.ensure_odoo_containers_ready(project, log=log)
        self.install_project_pip_requirements(project, log=log)

        action = "installation" if option == "-i" else "mise à jour"
        extra_args = ["--i18n-overwrite"] if overwrite_translations else []
        if overwrite_translations:
            action += " avec réinitialisation des traductions"
        self.log(log, "")
        self.log(log, f"Commande Odoo ({action})")
        self.log(log, f"Projet: {project}")
        self.log(log, f"Base: {db_name}")
        self.log(log, f"Module(s): {modules}")
        self.log(
            log, f"Équivalent: odoo -d {db_name} {option} {modules} {' '.join([*extra_args, '--stop-after-init'])}"
        )
        was_neutralized = self.database_is_neutralized(project, db_name)
        self.register_module_operations_revert(project, db_name, log=log)

        self.stop_odoo_server(project, log=log)
        odoo_arguments = [
            "odoo_cli",
            "-c",
            "/home/odoo/srv/conf/odoo.conf",
            "-d",
            db_name,
            option,
            modules,
            *extra_args,
            "--stop-after-init",
        ]
        module_log = f"/home/odoo/srv/data/odoo-manager-module-{uuid.uuid4().hex}.log"
        shell_command = (
            "set -o pipefail; "
            + ODOO_CLI_FUNCTION
            + " ".join(shlex.quote(argument) for argument in odoo_arguments)
            + f" 2>&1 | tee {shlex.quote(module_log)}; "
            + 'exit "${PIPESTATUS[0]}"'
        )
        command = self.docker(
            "exec",
            "-e",
            "LOG_ATTACHMENTS=False",
            container,
            "bash",
            "-lc",
            shell_command,
        )
        command_error = None
        command_severity_error = None
        command_error_detail = []
        traceback_chain = TracebackChain()

        def log_module_output(line):
            nonlocal command_error, command_severity_error, command_error_detail
            for part in str(line).replace("\r", "\n").splitlines():
                part = part.strip()
                if not part:
                    continue
                traceback_chain.feed(part)
                if re.search(r"\b(?:ERROR|CRITICAL)\b", part):
                    command_severity_error = part
                elif re.match(r"\d{4}-\d\d-\d\d .*\b(?:INFO|WARNING|DEBUG)\b", part):
                    command_severity_error = None
                elif command_severity_error and PYTHON_EXCEPTION_LINE_RE.search(part):
                    command_error = part
                    command_error_detail = []
                elif command_error:
                    command_error_detail.append(part)
            self.log(log, line)

        if overwrite_translations:
            label = "Réinitialisation des traductions"
        else:
            label = "Installation des modules" if option == "-i" else "Mise à jour des modules"
        job_progress.span(label, share=0.9, expected=module_command_expected_seconds(modules))
        code = None
        try:
            code = self.stream(command, log=log_module_output)
            if code != 0:
                log_code, module_output = self.capture(
                    self.docker(
                        "exec", container, "sh", "-lc", f"tail -n 400 {shlex.quote(module_log)} 2>/dev/null || true"
                    ),
                    timeout=12,
                )
                if command_error:
                    reason = (
                        f"Dernière erreur Odoo : {command_error[:350]}{self.odoo_error_detail(command_error_detail)}"
                        f"{traceback_chain.origin_of(command_error)}"
                    )
                elif command_severity_error:
                    reason = f"Dernière erreur Odoo : {command_severity_error[:350]}"
                else:
                    reason = self.odoo_command_failure_reason(module_output.splitlines() if log_code == 0 else [])
                self.log(log, f"Échec de la commande Odoo (code {code}). {reason}")
                self.log(log, f"Journal complet de cette commande dans le conteneur : {module_log}")
                if module_output:
                    self.log(log, "Dernières lignes de la commande de mise à jour Odoo:")
                    self.log(log, module_output)
                raise OdooError(f"La commande Odoo a échoué avec le code {code}. {reason}")
            if was_neutralized:
                self.log(log, "La base était neutralisée: nouvelle passe après l'opération module...")
                self._execute_database_neutralization(project, db_name, log=log)
        except BaseException:
            self.restart_odoo_server_after_failure(project, log=log)
            raise
        job_progress.span("Redémarrage d'Odoo", share=0.8, expected=20)
        self.log(log, "Redémarrage du serveur Odoo...")
        self.start_odoo_server(project, log=log)
        self.wait_project_http(project, log=log)
        self.log(log, "Opération module terminée.")
        self.log(log, f"URL Odoo: {self.project_url(project)}")

    @staticmethod
    def odoo_error_detail(lines):
        """Explication qu'Odoo écrit sous une exception, par exemple sous un ParseError de vue.

        « ParseError: while parsing ….xml:3 » seul ne dit pas quoi corriger : la cause
        (« Le champ `x` n'existe pas ») est quelques lignes plus bas.
        """
        explanation = re.compile(
            r"n'existe pas|does not exist|non-existing|introuvable|not found|cannot be located|"
            r"ne peut pas être localisé|invalide|invalid|inconnu|unknown",
            re.IGNORECASE,
        )
        for line in lines[:40]:
            line = line.strip()
            if line.startswith(("View error context", "Contexte d'erreur")) or re.match(r"\d{4}-\d\d-\d\d ", line):
                break
            if explanation.search(line) and not line.startswith("<"):
                return f" — {line[:250]}"
        return ""

    @classmethod
    def odoo_command_failure_reason(cls, lines):
        exception = PYTHON_EXCEPTION_LINE_RE
        severity = re.compile(r"\b(?:ERROR|CRITICAL)\b")
        last_severity = None
        last_exception = None
        exception_index = None
        in_error_block = False
        traceback_chain = TracebackChain()
        for index, line in enumerate(lines):
            if not line:
                continue
            traceback_chain.feed(line.strip())
            if severity.search(line):
                last_severity = line
                in_error_block = True
            elif re.match(r"\d{4}-\d\d-\d\d .*\b(?:INFO|WARNING|DEBUG)\b", line):
                in_error_block = False
            elif in_error_block and exception.search(line):
                last_exception = line
                exception_index = index
        if last_exception:
            detail = cls.odoo_error_detail(list(lines[exception_index + 1 :]))
            return f"Dernière erreur Odoo : {last_exception[:350]}{detail}{traceback_chain.origin_of(last_exception)}"
        if last_severity:
            return f"Dernière erreur Odoo : {last_severity[:350]}"
        return "Cause non présente dans la sortie reçue. Consultez les Logs de cette tâche."

    def run_odoo_shell_script(self, project, db_name, script, failure_message, env=None, secrets=(), log=None):
        """Exécute un script `odoo shell` serveur arrêté, puis redémarre Odoo.

        Les valeurs de `secrets` sont masquées dans tout ce qui part vers le log,
        y compris la ligne de commande docker qui transporte les variables.
        """
        container = f"odoo-{project}"
        secrets = [value for value in secrets if value]

        def safe_log(line):
            text = str(line)
            for value in secrets:
                text = text.replace(value, "********")
            self.log(log, text)

        environment = ["-e", "LOG_ATTACHMENTS=False", "-e", f"ODOO_DB_NAME={db_name}"]
        for key, value in (env or {}).items():
            environment.extend(["-e", f"{key}={value}"])
        shell_command = (
            ODOO_CLI_FUNCTION + "odoo_cli shell -c /home/odoo/srv/conf/odoo.conf "
            "-d \"$ODOO_DB_NAME\" --no-http <<'ODOO_MANAGER_PY'\n"
            f"{script}ODOO_MANAGER_PY"
        )

        self.stop_odoo_server(project, log=log)
        command = self.docker("exec", *environment, container, "sh", "-lc", shell_command)
        try:
            code = self.stream(command, log=safe_log)
            if code != 0:
                self.odoo_startup_diagnostics(container, log=log)
                raise RuntimeError(f"{failure_message} (code {code}).")
        except BaseException:
            self.restart_odoo_server_after_failure(project, log=log)
            raise
        self.log(log, "Redémarrage du serveur Odoo...")
        self.start_odoo_server(project, log=log)
        self.wait_project_http(project, log=log)

    def run_odoo_regenerate_assets(self, project, db_name, log=None):
        self.ensure_odoo_containers_ready(project, log=log)
        self.log(log, "")
        self.log(log, "Régénération des assets Odoo")
        self.log(log, f"Projet: {project}")
        self.log(log, f"Base: {db_name}")
        script = """attachments = env["ir.attachment"].sudo().search([("url", "=like", "/web/assets/%")])
count = len(attachments)
attachments.unlink()
env.cr.commit()
print(f"{count} bundle(s) d'assets supprimé(s), régénérés au prochain chargement d'une page.")
"""
        self.run_odoo_shell_script(
            project,
            db_name,
            script,
            "La régénération des assets a échoué",
            log=log,
        )
        self.log(log, "Assets purgés. Recharge la page Odoo (Ctrl+Maj+R) pour les reconstruire.")
        self.log(log, f"URL Odoo: {self.project_url(project)}")

    def run_odoo_reset_all_translations(self, project, db_name, languages=(), log=None):
        languages = [code for code in languages if code]
        self.ensure_odoo_containers_ready(project, log=log)
        self.log(log, "")
        self.log(log, "Réinitialisation des traductions de tous les modules installés")
        self.log(log, f"Projet: {project}")
        self.log(log, f"Base: {db_name}")
        self.log(log, "Langue(s): " + (", ".join(languages) if languages else "toutes les langues installées"))
        # Même traitement que le wizard Odoo « Langues › Mettre à jour » avec
        # « Écraser les termes existants » : termes .po seulement, sans -u all.
        script = """import os

installed = [code for code, _name in env["res.lang"].get_installed()]
languages = [code for code in os.environ.get("ODOO_LANGUAGES", "").split(",") if code] or installed
unknown = sorted(set(languages) - set(installed))
if unknown:
    raise SystemExit("Langue(s) non installée(s) dans la base : " + ", ".join(unknown))
modules = env["ir.module.module"].search([("state", "=", "installed")])
print(f"Rechargement des termes ({', '.join(languages)}) pour {len(modules)} module(s) installé(s)...")
modules._update_translations(languages, overwrite=True)
env.cr.commit()
print("Traductions réinitialisées depuis les fichiers .po.")
"""
        self.run_odoo_shell_script(
            project,
            db_name,
            script,
            "La réinitialisation des traductions a échoué",
            env={"ODOO_LANGUAGES": ",".join(languages)},
            log=log,
        )
        self.log(log, "Traductions de tous les modules réinitialisées.")
        self.log(log, f"URL Odoo: {self.project_url(project)}")

    def run_odoo_reset_admin_password(self, project, db_name, password, log=None):
        if not password:
            raise ValueError("Le nouveau mot de passe administrateur est vide.")
        self.ensure_odoo_containers_ready(project, log=log)
        self.log(log, "")
        self.log(log, "Réinitialisation du mot de passe administrateur Odoo")
        self.log(log, f"Projet: {project}")
        self.log(log, f"Base: {db_name}")
        script = """import os

user = env.ref("base.user_admin", raise_if_not_found=False)
if not user:
    raise SystemExit("Utilisateur administrateur base.user_admin introuvable.")
user = user.sudo()
values = {"password": os.environ["ODOO_ADMIN_PASSWORD"]}
if not user.active:
    values["active"] = True
user.write(values)
env.cr.commit()
print("Mot de passe réinitialisé pour l'identifiant : " + user.login)
"""
        self.run_odoo_shell_script(
            project,
            db_name,
            script,
            "La réinitialisation du mot de passe administrateur a échoué",
            env={"ODOO_ADMIN_PASSWORD": password},
            secrets=(password,),
            log=log,
        )
        self.log(log, "Mot de passe administrateur réinitialisé.")
        self.log(log, f"URL Odoo: {self.project_url(project)}")

    def run_odoo_create_test_user(self, project, db_name, login, with_settings=False, log=None):
        """Crée ou remet à jour un utilisateur de recette, mot de passe identique à l'identifiant.

        Il reçoit le niveau le plus élevé de chaque application, sauf les Ressources humaines
        (paie, congés, recrutement, notes de frais...) et, par défaut, l'administration.
        """
        if not login:
            raise ValueError("L'identifiant de l'utilisateur de recette est vide.")
        self.ensure_odoo_containers_ready(project, log=log)
        self.log(log, "")
        self.log(log, "Création de l'utilisateur de recette")
        self.log(log, f"Projet: {project}")
        self.log(log, f"Base: {db_name}")
        self.log(log, f"Identifiant et mot de passe: {login}")
        self.log(log, "Accès aux Paramètres: " + ("oui" if with_settings else "non"))
        # Odoo 19 regroupe les niveaux d'une application dans res.groups.privilege et
        # renomme groups_id en group_ids ; les versions précédentes passent par category_id.
        script = """import os

login = os.environ["ODOO_TEST_USER_LOGIN"]
with_settings = os.environ.get("ODOO_TEST_USER_SETTINGS") == "1"
Users = env["res.users"].sudo().with_context(active_test=False, no_reset_password=True)
Groups = env["res.groups"].sudo()
Category = env["ir.module.category"].sudo()
users_field = "group_ids" if "group_ids" in Users._fields else "groups_id"
uses_privileges = "privilege_id" in Groups._fields


def ref(xmlid):
    return env.ref(xmlid, raise_if_not_found=False)


def closure(groups):
    result = Groups.browse()
    pending = groups
    while pending:
        result |= pending
        pending = pending.mapped("implied_ids") - result
    return result


def category_of(group):
    if uses_privileges:
        return group.privilege_id.category_id
    return group.category_id


def selection_of(group):
    return group.privilege_id if uses_privileges else group.category_id


hr_root = ref("base.module_category_human_resources")
hr_categories = Category.search([("id", "child_of", hr_root.id)]) if hr_root else Category.browse()
# Les administrateurs de Documents voient tous les fichiers, bulletins de paie compris :
# le compte de recette reste au niveau utilisateur, qui respecte les droits par dossier.
sensitive_xmlids = {"documents.group_documents_manager", "documents.group_documents_system"}
xmlids = {}
for data in env["ir.model.data"].sudo().search([("model", "=", "res.groups")]):
    xmlids.setdefault(data.res_id, (data.module, data.name))


def is_sensitive(group):
    module, name = xmlids.get(group.id, ("", ""))
    if module + "." + name in sensitive_xmlids:
        return True
    if module == "hr" or "payroll" in module:
        return True
    if module.startswith("hr_") and not module.startswith("hr_timesheet"):
        return True
    return bool(category_of(group) & hr_categories)


def is_hidden(group):
    category = category_of(group)
    while category:
        if "visible" in category._fields and not category.visible:
            return True
        category = category.parent_id
    return False


admin_groups = Groups.browse([g.id for g in (ref("base.group_erp_manager"), ref("base.group_system")) if g])
# Options activées dans les Paramètres (ex. « Afficher le PDF de la fiche de paie ») : tout
# utilisateur interne les reçoit déjà, elles ne donnent accès à aucune donnée.
baseline = closure(ref("base.group_user"))
user_type = ref("base.module_category_user_type")
candidates = Groups.search([("share", "=", False)])
allowed = Groups.browse()
excluded = Groups.browse()
for group in candidates:
    if not selection_of(group) or (user_type and category_of(group) == user_type) or is_hidden(group):
        continue
    implied = closure(group) - baseline
    if implied.filtered(is_sensitive):
        excluded |= group
    elif implied & admin_groups:
        continue
    else:
        allowed |= group

# Dans chaque application, seul le niveau le plus élevé est donné : il inclut les autres.
granted = Groups.browse()
for selection in allowed.mapped(lambda group: selection_of(group)):
    levels = allowed.filtered(lambda group: selection_of(group) == selection)
    for group in levels:
        others = levels - group
        if not any(group in closure(other) - other for other in others):
            granted |= group
granted |= ref("base.group_user")
if with_settings and ref("base.group_system"):
    granted |= ref("base.group_system")

leaked = (closure(granted) - baseline).filtered(is_sensitive)
if leaked:
    raise SystemExit("Droits sensibles accordés par erreur, rien n'est enregistré : " + ", ".join(leaked.mapped("full_name")))

protected = Users.browse([user.id for user in (ref("base.user_root"), ref("base.user_admin")) if user])
user = Users.search([("login", "=", login)], limit=1)
if user & protected:
    raise SystemExit("L'identifiant " + login + " est celui de l'administrateur : choisis-en un autre.")

admin = ref("base.user_admin") or env.user
companies = env["res.company"].sudo().search([])
values = {
    "password": login,
    "active": True,
    users_field: [(6, 0, granted.ids)],
    "company_ids": [(6, 0, companies.ids)],
    "company_id": (admin.company_id or companies[:1]).id,
}
if user:
    user.write(values)
    print("Utilisateur existant mis à jour : " + login)
else:
    values.update({"name": "Utilisateur de recette (" + login + ")", "login": login, "lang": admin.lang, "tz": admin.tz})
    user = Users.create(values)
    print("Utilisateur créé : " + login)
env.cr.commit()

print("Droits accordés :")
for name in sorted(granted.mapped("full_name")):
    print("  + " + name)
if excluded:
    print("Droits non accordés (ressources humaines, paie, données personnelles) :")
    for name in sorted(excluded.mapped("full_name")):
        print("  - " + name)
"""
        self.run_odoo_shell_script(
            project,
            db_name,
            script,
            "La création de l'utilisateur de recette a échoué",
            env={"ODOO_TEST_USER_LOGIN": login, "ODOO_TEST_USER_SETTINGS": "1" if with_settings else "0"},
            log=log,
        )
        self.log(log, f"Utilisateur de recette prêt : identifiant {login}, mot de passe {login}.")
        self.log(log, f"URL Odoo: {self.project_url(project)}")

    def run_odoo_fix_expired_database(self, project, db_name, log=None):
        """Repousse la date d'expiration et coupe la tâche qui la redemande aux serveurs d'Odoo."""
        self.ensure_odoo_containers_ready(project, log=log)
        self.log(log, "")
        self.log(log, "Correction d'une base expirée")
        self.log(log, f"Projet: {project}")
        self.log(log, f"Base: {db_name}")
        # La tâche planifiée « Publisher: Update Notification » interroge odoo.com chaque
        # semaine et réécrit database.expiration_date : la date seule ne tiendrait pas.
        script = f"""import datetime

from odoo import fields

ICP = env["ir.config_parameter"].sudo()
# Odoo 20 remplace get_param/set_param par des accesseurs typés.
get_param = getattr(ICP, "get_str", None) or ICP.get_param
set_param = getattr(ICP, "set_str", None) or ICP.set_param
previous = get_param("database.expiration_date") or ""
expiration = fields.Datetime.now() + datetime.timedelta(days={DATABASE_EXPIRATION_DAYS})
try:
    current = fields.Datetime.to_datetime(previous)
except ValueError:
    current = None
if current and current > expiration:
    print("Date d'expiration conservée, déjà plus lointaine : " + previous)
else:
    expiration = fields.Datetime.to_string(expiration)
    set_param("database.expiration_date", expiration)
    print("Date d'expiration : " + (previous or "aucune") + " -> " + expiration)

Cron = env["ir.cron"].sudo().with_context(active_test=False)
crons = Cron.search([("model_id.model", "=", "publisher_warranty.contract")])
legacy = env.ref("mail.ir_cron_module_update_notification", raise_if_not_found=False)
if legacy:
    crons |= legacy.sudo()
active = crons.filtered("active")
if active:
    active.write({{"active": False}})
if crons:
    print(f"Contact avec les serveurs d'Odoo désactivé ({{len(active)}} tâche(s) arrêtée(s) sur {{len(crons)}}).")
else:
    print("Aucune tâche de contact avec les serveurs d'Odoo dans cette base.")
env.cr.commit()
"""
        self.run_odoo_shell_script(
            project,
            db_name,
            script,
            "La correction de la base expirée a échoué",
            log=log,
        )
        self.log(log, "Base corrigée. Recharge la page Odoo pour faire disparaître le message d'expiration.")
        self.log(log, f"URL Odoo: {self.project_url(project)}")

    def pending_module_operations(self, project, db_name):
        """Modules en attente d'installation, de mise à jour ou de suppression ; None si illisible."""
        code, output = self.capture(
            self.docker(
                "exec",
                f"postgresql-{project}",
                "psql",
                "-X",
                "-U",
                "postgres",
                "-d",
                db_name,
                "-Atc",
                f"select name from ir_module_module where state in {PENDING_MODULE_STATES_SQL} order by name;",
            ),
            timeout=20,
        )
        if code != 0:
            return None
        return {line.strip() for line in output.splitlines() if line.strip()}

    def register_module_operations_revert(self, project, db_name, log=None):
        """À l'arrêt de l'action, remet dans leur état précédent les modules qu'elle a laissés en attente.

        Odoo valide chaque module traité : ceux-là restent modifiés. Les opérations qui
        attendaient déjà avant l'action ne sont pas touchées.
        """
        if jobs.current_control() is None:
            return
        before = self.pending_module_operations(project, db_name)
        if before is None:
            self.log(log, f"États des modules de {db_name} illisibles : pas de remise en état possible en cas d'arrêt.")
            return
        jobs.on_cancel(
            f"remise en état des modules laissés en attente dans {db_name}",
            lambda: self.reset_pending_module_operations(project, db_name, before, log=log),
        )

    def reset_pending_module_operations(self, project, db_name, keep=(), log=None):
        excluded = ",".join("'" + name.replace("'", "''") + "'" for name in sorted(keep))
        condition = f"state in {PENDING_MODULE_STATES_SQL}" + (f" and name not in ({excluded})" if excluded else "")
        query = (
            "update ir_module_module "
            "set state = case when state = 'to install' then 'uninstalled' else 'installed' end "
            f"where {condition} returning name || ' -> ' || state;"
        )
        code, output = self.capture(
            self.docker(
                "exec",
                f"postgresql-{project}",
                "psql",
                "-X",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "postgres",
                "-d",
                db_name,
                "-Atc",
                query,
            ),
            timeout=60,
        )
        if code != 0:
            raise RuntimeError(output or f"Remise en état des modules de {db_name} impossible.")
        changed = [line.strip() for line in output.splitlines() if "->" in line]
        if changed:
            self.log(log, "Modules remis dans leur état précédent : " + ", ".join(changed))
        else:
            self.log(log, "Aucun module laissé en attente par l'action.")

    def register_start_revert(self, project, path, log=None):
        """À l'arrêt de l'action, remet le projet dans l'état où elle l'a trouvé."""
        if jobs.current_control() is None:
            return
        container = f"odoo-{project}"
        statuses = (self.container_status(container), self.container_status(f"postgresql-{project}"))
        if any(status != "running" for status in statuses):
            jobs.on_cancel(
                f"arrêt des conteneurs de {project} démarrés par cette action",
                lambda: self.stream(self.docker("compose", "stop"), cwd=path, log=log),
            )
        elif self.odoo_server_state(container) != "running":
            jobs.on_cancel(
                f"arrêt du serveur Odoo de {project} lancé par cette action",
                lambda: self.stop_odoo_server(project, log=log),
            )

    def run_odoo_uninstall_command(self, project, db_name, modules, log=None):
        self.ensure_odoo_containers_ready(project, log=log)
        self.register_module_operations_revert(project, db_name, log=log)

        self.log(log, "")
        self.log(log, "Commande Odoo (désinstallation)")
        self.log(log, f"Projet: {project}")
        self.log(log, f"Base: {db_name}")
        self.log(log, f"Module(s): {modules}")

        uninstall_script = """import os

module_names = [name.strip() for name in os.environ.get("MODULE_NAMES", "").split(",") if name.strip()]
if not module_names:
    raise SystemExit("Aucun module fourni.")

modules = env["ir.module.module"].search([("name", "in", module_names)])
found = set(modules.mapped("name"))
missing = sorted(set(module_names) - found)
if missing:
    print("Module(s) introuvable(s): " + ", ".join(missing))

installed = modules.filtered(lambda module: module.state == "installed")
skipped = modules - installed
if skipped:
    print("Module(s) ignoré(s) car non installé(s): " + ", ".join(skipped.mapped("name")))

if not installed:
    raise SystemExit("Aucun module installé à désinstaller.")

print("Désinstallation: " + ", ".join(installed.mapped("name")))
installed.button_immediate_uninstall()
env.cr.commit()
print("Désinstallation terminée.")
"""
        self.run_odoo_shell_script(
            project,
            db_name,
            uninstall_script,
            "La désinstallation Odoo a échoué",
            env={"MODULE_NAMES": modules},
            log=log,
        )
        self.log(log, "Désinstallation terminée.")
        self.log(log, f"URL Odoo: {self.project_url(project)}")

    def _database_scalar(self, project, db_name, query, timeout=20):
        code, output = self.capture(
            self.docker(
                "exec",
                f"postgresql-{project}",
                "psql",
                "-X",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "postgres",
                "-d",
                db_name,
                "-Atc",
                query,
            ),
            timeout=timeout,
        )
        if code != 0:
            raise RuntimeError(output or "Le contrôle PostgreSQL de la neutralisation a échoué.")
        return output.strip()

    def database_is_neutralized(self, project, db_name):
        value = self._database_scalar(
            project,
            db_name,
            "SELECT COALESCE((SELECT value FROM ir_config_parameter WHERE key = 'database.is_neutralized' LIMIT 1), '');",
        )
        return value.lower() in {"1", "true", "t", "yes"}

    def verify_database_neutralization(self, project, db_name, log=None):
        core_status = self._database_scalar(
            project,
            db_name,
            """
SELECT COALESCE((SELECT value FROM ir_config_parameter WHERE key = 'database.is_neutralized' LIMIT 1), ''),
       (SELECT count(*) FROM ir_cron
         WHERE active
           AND id NOT IN (
               SELECT res_id FROM ir_model_data
                WHERE model = 'ir.cron' AND module = 'base' AND name = 'autovacuum_job'
           )),
       (SELECT count(*) FROM ir_mail_server
         WHERE active AND COALESCE(smtp_host, '') NOT IN ('invalid', 'mailpit'));
""".strip(),
        )
        parts = core_status.split("|")
        if len(parts) != 3:
            raise RuntimeError("Réponse PostgreSQL illisible pendant le contrôle de neutralisation.")
        flag, active_crons, usable_outgoing_servers = parts
        if flag.lower() not in {"1", "true", "t", "yes"}:
            raise RuntimeError("Odoo n'a pas marqué la base comme neutralisée.")
        if active_crons != "0":
            raise RuntimeError(f"{active_crons} cron(s) métier sont encore actifs.")
        if usable_outgoing_servers != "0":
            raise RuntimeError(f"{usable_outgoing_servers} serveur(s) sortant(s) exploitable(s) sont encore actifs.")

        fetchmail_table = self._database_scalar(
            project,
            db_name,
            "SELECT CASE WHEN to_regclass('public.fetchmail_server') IS NULL THEN 'absent' ELSE 'present' END;",
        )
        active_incoming_servers = "0"
        if fetchmail_table == "present":
            active_incoming_servers = self._database_scalar(
                project,
                db_name,
                "SELECT count(*) FROM fetchmail_server WHERE active;",
            )
            if active_incoming_servers != "0":
                raise RuntimeError(f"{active_incoming_servers} serveur(s) entrant(s) sont encore actifs.")

        self.log(log, "Contrôles de neutralisation validés:")
        self.log(log, "- base marquée comme neutralisée")
        self.log(log, "- 0 cron métier actif (seul l'autovacuum Odoo peut rester actif)")
        self.log(log, "- 0 serveur de messagerie sortant exploitable (e-mails capturés par Mailpit s'il est démarré)")
        self.log(log, f"- {active_incoming_servers} serveur de messagerie entrant actif")

    @staticmethod
    def _neutralization_shell_command():
        neutralize_script = """try:
    from odoo.modules.neutralize import neutralize_database
except ImportError:
    # Odoo 15 ne fournit pas encore le moteur modulaire de neutralisation.
    autovacuum = env.ref("base.autovacuum_job", raise_if_not_found=False)
    crons = env["ir.cron"].search([])
    if autovacuum:
        crons -= autovacuum
    # Odoo 15 : ir.cron.write() sur un jeu vide exécute `WHERE id IN ()` et échoue en SQL.
    if crons:
        crons.write({"active": False})

    outgoing = env["ir.mail_server"].search([])
    if outgoing:
        outgoing.write({"active": False})
    dummy = env["ir.mail_server"].search([
        ("name", "=", "neutralization - disable emails"),
    ], limit=1)
    values = {
        "name": "neutralization - disable emails",
        "smtp_host": "invalid",
        "smtp_port": 1025,
        "smtp_encryption": "none",
        "smtp_authentication": "login",
        "active": True,
    }
    if dummy:
        dummy.write(values)
    else:
        env["ir.mail_server"].create(values)

    if "fetchmail.server" in env.registry:
        fetchmail_servers = env["fetchmail.server"].search([])
        if fetchmail_servers:
            fetchmail_servers.write({"active": False})
    env["ir.config_parameter"].sudo().set_param("database.is_neutralized", "true")
else:
    neutralize_database(env.cr)

# Le SQL natif insère un SMTP factice à chaque passe, et les passes précédentes en ont
# parfois archivé : les archivés comptent aussi. N'en conserver qu'un rend l'action réellement
# idempotente sans supprimer de serveur métier ; le plus récent actif est gardé.
dummies = env["ir.mail_server"].with_context(active_test=False).search([
    ("name", "=", "neutralization - disable emails"),
    ("smtp_host", "in", ("invalid", "mailpit")),
], order="active desc, id desc")
if len(dummies) > 1:
    dummies[1:].unlink()
# Le SMTP factice écoute déjà sur 1025, le port de Mailpit : les e-mails y sont capturés
# quand le conteneur mailpit tourne sur le réseau traefik-local, et échouent sinon.
if dummies:
    dummies[:1].write({"smtp_host": "mailpit", "active": True})

env.cr.commit()
print("ODOO_MANAGER_NEUTRALIZATION_DONE")
"""
        return (
            ODOO_CLI_FUNCTION + "odoo_cli shell -c /home/odoo/srv/conf/odoo.conf "
            "-d \"$ODOO_DB_NAME\" --no-http <<'ODOO_MANAGER_PY'\n"
            f"{neutralize_script}ODOO_MANAGER_PY"
        )

    def _execute_database_neutralization(self, project, db_name, log=None):
        container = f"odoo-{project}"
        command = self.docker(
            "exec",
            "-e",
            "LOG_ATTACHMENTS=False",
            "-e",
            f"ODOO_DB_NAME={db_name}",
            container,
            "sh",
            "-lc",
            self._neutralization_shell_command(),
        )
        code = self.stream(command, log=log)
        if code != 0:
            self.odoo_startup_diagnostics(container, log=log)
            raise RuntimeError(
                "La neutralisation Odoo a échoué. La base ne doit pas être considérée comme neutralisée."
            )
        self.verify_database_neutralization(project, db_name, log=log)

    def run_odoo_neutralize_command(self, project, db_name, log=None):
        container = f"odoo-{project}"
        postgres = f"postgresql-{project}"
        if not self.is_running(container) or not self.is_running(postgres):
            raise RuntimeError("Les conteneurs Odoo et PostgreSQL doivent être démarrés pour neutraliser la base.")
        self.wait_for_odoo_container_initialization(container, log=log)

        self.log(log, "")
        self.log(log, "Neutralisation de la base Odoo")
        self.log(log, f"Projet: {project}")
        self.log(log, f"Base: {db_name}")
        self.log(log, "Arrêt préalable du serveur pour empêcher l'exécution concurrente d'un cron.")

        self.stop_odoo_server(project, log=log)
        try:
            self._execute_database_neutralization(project, db_name, log=log)
        except BaseException:
            self.restart_odoo_server_after_failure(project, log=log)
            raise
        self.log(log, "Redémarrage du serveur Odoo...")
        self.start_odoo_server(project, log=log)
        self.wait_project_http(project, log=log)
        self.log(log, "Neutralisation terminée et contrôlée.")
        self.log(log, f"URL Odoo: {self.project_url(project)}")

    def start_project_containers(self, project, log=None):
        """Démarre les conteneurs du projet, prêts à recevoir le serveur Odoo, sans lancer ce dernier."""
        path = self.project_path(project)
        compose = self.compose_file(project)
        if not compose:
            raise RuntimeError(f"Projet introuvable ou sans fichier compose: {project}")
        self.register_start_revert(project, path, log=log)
        self.fix_macos_localtime_mount(compose, log=log)
        self.fix_postgres_healthcheck_start_period(compose, log=log)
        self.start_traefik(log=log)
        self.log(log, f"Démarrage du projet {project}...")
        try:
            self.compose_up_project(project, path, log=log)
        except RuntimeError:
            # Disque saturé par les restes d'une restauration interrompue : PostgreSQL ne démarre
            # plus, et le nettoyage prévu après le démarrage n'aurait jamais lieu.
            if not self.free_space_from_restore_leftovers(project, log=log):
                raise
            self.log(log, "Nouvel essai de démarrage après le nettoyage...")
            self.compose_up_project(project, path, log=log)
        container = f"odoo-{project}"
        self.detach_odoo_from_container_command(project, log=log)
        self.wait_for_container(container, log=log)
        self.wait_for_odoo_container_initialization(container, log=log)
        self.remove_odoo_restore_leftovers(project, log=log)
        try:
            self.tune_postgres(project, log=log)
        except RuntimeError as exc:
            # Un projet doit démarrer même avec les réglages d'origine de PostgreSQL.
            self.log(log, f"Réglages PostgreSQL non appliqués : {exc}")

    def start_project(self, project, log=None):
        self.start_project_containers(project, log=log)
        self.start_odoo_server(project, log=log)
        self.wait_project_http(project, log=log)
        self.log(log, "")
        self.log(log, f"Projet démarré: {project}")
        self.log(log, f"URL Odoo: {self.project_url(project)}")

    def stop_project(self, project, log=None):
        path = self.project_path(project)
        if not self.compose_file(project):
            raise RuntimeError(f"Projet introuvable ou sans fichier compose: {project}")
        self.log(log, f"Arrêt du projet {project}")
        code = self.stream(self.docker("compose", "stop"), cwd=path, log=log)
        if code != 0:
            raise RuntimeError("Impossible d'arrêter Docker Compose proprement.")
        self.log(log, f"Projet arrêté: {project}")

    def update_project(self, project, log=None):
        path = self.project_path(project)
        compose = self.compose_file(project)
        if not compose:
            raise RuntimeError(f"Projet introuvable ou sans fichier compose: {project}")
        self.fix_macos_localtime_mount(compose, log=log)
        self.log(log, "")
        self.log(log, f"Mise à jour du projet {project}")
        if (path / ".git").exists():
            self.log(log, "Git pull...")
            # Un git pull interrompu laisse des verrous et un index à moitié écrit : il va à son terme.
            with jobs.protected("git pull du projet"):
                code = self.stream(self.git("pull", "--ff-only"), cwd=path, log=log)
            if code != 0:
                raise RuntimeError(f"Git pull impossible pour {project}.")
        else:
            self.log(log, "Pas de dépôt Git dans ce projet.")

        container = f"odoo-{project}"
        odoo_was_serving = self.odoo_server_state(container) == "running"

        self.log(log, "Docker pull...")
        code = self.stream(self.docker("compose", "pull"), cwd=path, log=log)
        if code != 0:
            raise RuntimeError(f"Docker pull impossible pour {project}.")

        self.log(log, "Redémarrage compose...")
        self.compose_up_project(project, path, log=log, recreate_changed=True)
        # Un conteneur recréé sur la nouvelle image repart sans serveur Odoo : il est relancé
        # s'il tournait avant la mise à jour.
        if odoo_was_serving and self.odoo_server_state(container) != "running":
            self.log(log, "Nouvelle image appliquée : relance du serveur Odoo...")
            self.wait_for_container(container, log=log)
            self.wait_for_odoo_container_initialization(container, log=log)
            self.start_odoo_server(project, log=log)
            self.wait_project_http(project, log=log)
        self.log(log, f"Mise à jour terminée: {project}")

    def update_all_projects(self, log=None):
        for project in self.list_projects():
            self.update_project(project, log=log)
