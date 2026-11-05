"""IoT Box virtuelle : le code IoT d'Odoo dans un conteneur, à côté des projets.

Une seule box sur la machine, comme une vraie IoT Box reliée à une base à la fois. Elle tourne
avec le code Odoo du projet choisi, donc dans sa version : changer de projet recrée le conteneur.
La configuration de la box (base reliée, numéro de série) reste dans un volume par version.

Le code IoT 17.0 et 18.0 est écrit pour le Raspberry Pi (sudo, dépôt git dans /home/pi/odoo,
numéro de série dans /sys) : l'image en reproduit juste assez. Celui de 19.0 a un mode « Test »
prévu pour tourner ailleurs que sur un Pi.
"""

import hashlib
import json
from pathlib import Path
from urllib.parse import urlencode

IOTBOX_CONTAINER = "iotbox"
IOTBOX_IMAGE = "odoo-manager-iotbox"
IOTBOX_HOST = "iot.localhost"
IOTBOX_RECIPE_LABEL = "odoo-manager.iotbox.recipe"
IOTBOX_PROJECT_LABEL = "odoo-manager.iotbox.project"
IOTBOX_VERSION_LABEL = "odoo-manager.iotbox.version"
# Modules que la box charge sans base, par version d'Odoo (server_wide_modules de l'image officielle).
IOTBOX_MODULES = {
    "17.0": "hw_drivers,hw_escpos,hw_posbox_homepage,web",
    "18.0": "hw_drivers,hw_escpos,hw_posbox_homepage,web",
    "19.0": "iot_drivers,web",
}
# Paramètre où la base attend le jeton d'appairage (assistant « Connecter une IoT Box » d'Odoo).
IOTBOX_TOKEN_PARAMETERS = {"17.0": "iot_token", "18.0": "iot_token", "19.0": "iot.iot_token"}
# Page de la box qui reçoit ce jeton.
IOTBOX_CONNECT_ROUTES = {
    "17.0": "/hw_posbox_homepage/connect_to_server",
    "18.0": "/hw_posbox_homepage/connect_to_server",
    "19.0": "/iot_drivers/connect_to_server",
}

DOCKERFILE = """\
ARG BASE=sudokeys/docker-odoo-local:19.0
FROM ${BASE}
USER root
RUN apt-get update \\
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \\
    dbus cups cups-bsd libcups2-dev libusb-1.0-0 libdbus-1-dev libglib2.0-dev pkg-config \\
 && rm -rf /var/lib/apt/lists/*
RUN . "$PYTHON_VENV_PATH/bin/activate" \\
 && pip install --no-cache-dir netifaces pycups python-escpos websocket-client schedule pyusb pyserial \\
    pyudev evdev polib dbus-python --config-settings=setup-args=-Dtests=false
RUN id pi >/dev/null 2>&1 || useradd -M -d /home/pi pi
COPY sudo /usr/local/bin/
COPY git /usr/bin/git
COPY entrypoint.sh /usr/local/bin/iotbox-entrypoint
COPY sitecustomize.py /tmp/sitecustomize.py
RUN chmod +x /usr/local/bin/sudo /usr/bin/git /usr/local/bin/iotbox-entrypoint \\
 && mv /tmp/sitecustomize.py "$("$PYTHON_VENV_PATH/bin/python" -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])')/" \\
 && mkdir -p /var/odoo && echo 24.10 > /var/odoo/iotbox_version
EXPOSE 8069
ENTRYPOINT ["/usr/local/bin/iotbox-entrypoint"]
"""

SUDO_SHIM = """\
#!/bin/sh
# Le code IoT du Raspberry Pi remonte le disque, relance nginx, renomme la machine : sans objet ici.
case "$1" in mount|service|systemctl|hostname|reboot|chmod|chown) exit 0;; esac
exec "$@"
"""

GIT_SHIM = """\
#!/bin/sh
# Le code IoT 17/18 se met à jour par git (fetch, reset, clean) dans /home/pi/odoo, qui est ici le code du
# projet : git ne fait rien dans la box. Sans réponse à `ls-remote`, la box saute sa mise à jour.
exit 0
"""

SITECUSTOMIZE = """\
# Le code IoT 17/18 lit le numéro de série du Raspberry Pi, que Docker masque : on lit celui de la box.
import pathlib

_PI_SERIAL = "/sys/firmware/devicetree/base/serial-number"
_BOX_SERIAL = pathlib.Path("/home/pi/serial-number")


def _redirect(method):
    def wrapper(self, *args, **kwargs):
        return method(_BOX_SERIAL if str(self) == _PI_SERIAL else self, *args, **kwargs)

    return wrapper


pathlib.Path.exists = _redirect(pathlib.Path.exists)
pathlib.Path.open = _redirect(pathlib.Path.open)


# Odoo 17/18 ne choisit la base d'une requête que par la session (ou s'il n'y en a qu'une), et leur box
# n'en envoie pas : chaque appel vers la base reliée porte une session ouverte sur elle. La box 19
# envoie déjà l'en-tête X-Odoo-Database.
if pathlib.Path("/home/pi/odoo/addons/hw_drivers").is_dir():
    import configparser
    import http.cookies
    import time
    import urllib.error
    import urllib.parse
    import urllib.request

    _SESSION = {"key": None, "cookie": "", "at": 0.0}

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    def _linked_database():
        conf = configparser.ConfigParser()
        conf.read("/home/pi/odoo.conf")
        return conf.get("iot.box", "remote_server", fallback=""), conf.get("iot.box", "db_name", fallback="")

    def _session_cookie(host):
        server, db = _linked_database()
        if not server or not db or urllib.parse.urlsplit(server).hostname != host:
            return ""
        # Renouvelée chaque heure : Odoo efface les sessions restées inactives.
        if _SESSION["key"] == (server, db) and time.monotonic() - _SESSION["at"] < 3600:
            return _SESSION["cookie"]
        try:
            response = urllib.request.build_opener(_NoRedirect).open(
                f"{server}/web/login?db={urllib.parse.quote(db)}", timeout=10
            )
        except urllib.error.HTTPError as redirect:
            response = redirect
        except OSError:
            return ""
        cookies = http.cookies.SimpleCookie()
        for header in response.headers.get_all("Set-Cookie") or []:
            cookies.load(header)
        cookie = cookies["session_id"].value if "session_id" in cookies else ""
        _SESSION.update(key=(server, db), cookie=cookie, at=time.monotonic())
        return cookie

    try:
        import urllib3.connectionpool

        _urlopen = urllib3.connectionpool.HTTPConnectionPool.urlopen

        def _urlopen_with_session(self, method, url, body=None, headers=None, **kwargs):
            cookie = _session_cookie(self.host)
            if cookie:
                headers = {**(headers or {}), "Cookie": f"session_id={cookie}"}
            return _urlopen(self, method, url, body, headers, **kwargs)

        urllib3.connectionpool.HTTPConnectionPool.urlopen = _urlopen_with_session
    except ImportError:
        pass

    try:
        import websocket

        _websocket_init = websocket.WebSocketApp.__init__

        def _websocket_init_with_session(self, url, *args, **kwargs):
            cookie = _session_cookie(urllib.parse.urlsplit(url).hostname)
            if cookie:
                kwargs["cookie"] = f"session_id={cookie}"
            _websocket_init(self, url, *args, **kwargs)

        websocket.WebSocketApp.__init__ = _websocket_init_with_session
    except ImportError:
        pass
"""

ENTRYPOINT = """\
#!/bin/bash
set -e
# Numéro de série et configuration gardés dans le volume de la box (/home/pi) d'un démarrage à l'autre.
[ -s /home/pi/serial-number ] || printf 'SDK%s\\n' "$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \\n')" > /home/pi/serial-number
[ -s /home/pi/odoo.conf ] || printf '[options]\\nlist_db = False\\nmax_cron_threads = 0\\ndata_dir = /home/pi/data\\nlog_handler = :INFO,werkzeug:WARNING\\n' > /home/pi/odoo.conf
mkdir -p /run/dbus && rm -f /run/dbus/pid && dbus-daemon --system --fork
cupsd
. "$PYTHON_VENV_PATH/bin/activate"
handlers="addons/${IOTBOX_MODULES%%,*}/iot_handlers"
cp -a "/home/pi/odoo-source/$handlers/." "/home/pi/odoo/$handlers/"
cd /home/pi/odoo
exec python odoo-bin -c /home/pi/odoo.conf --http-port=8069 --load="$IOTBOX_MODULES"
"""

BUILD_FILES = {
    "Dockerfile": DOCKERFILE,
    "sudo": SUDO_SHIM,
    "git": GIT_SHIM,
    "sitecustomize.py": SITECUSTOMIZE,
    "entrypoint.sh": ENTRYPOINT,
}
# Change avec la recette : une image ou une box d'avant une mise à jour du gestionnaire est refaite.
# À changer quand `run_arguments` change : une box lancée autrement est alors recréée.
RUN_LAYOUT = "3"
RECIPE_DIGEST = hashlib.sha256(
    "\0".join([RUN_LAYOUT, *(f"{k}\0{v}" for k, v in sorted(BUILD_FILES.items()))]).encode()
).hexdigest()[:12]


def image_tag(version):
    return f"{IOTBOX_IMAGE}:{version}"


def volume_name(version):
    return f"odoo-manager-iotbox-{version}"


def unsupported_reason(version):
    """Raison, en clair, pour laquelle la box ne peut pas tourner avec ce code, ou ""."""
    if version in IOTBOX_MODULES:
        return ""
    supported = ", ".join(IOTBOX_MODULES)
    if not version:
        return "La version d'Odoo de ce projet est inconnue : l'IoT Box virtuelle ne peut pas démarrer."
    return f"L'IoT Box virtuelle n'est disponible que pour Odoo {supported} (ce projet est en {version})."


def write_build_context(directory):
    """Écrit les fichiers de l'image ; les fins de ligne restent Unix, même écrites depuis Windows."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in BUILD_FILES.items():
        (directory / name).write_bytes(content.encode("utf-8"))
    return directory


def build_arguments(version):
    return [
        "build",
        "--build-arg",
        f"BASE=sudokeys/docker-odoo-local:{version}",
        "--label",
        f"{IOTBOX_RECIPE_LABEL}={RECIPE_DIGEST}",
        "--tag",
        image_tag(version),
        ".",
    ]


def run_arguments(project, version, network):
    """`docker run` lancé depuis le dossier du projet : le code Odoo y est monté en lecture seule."""
    return [
        "run",
        "--detach",
        "--name",
        IOTBOX_CONTAINER,
        "--hostname",
        IOTBOX_CONTAINER,
        "--restart",
        "unless-stopped",
        "--network",
        network,
        "--label",
        f"{IOTBOX_PROJECT_LABEL}={project}",
        "--label",
        f"{IOTBOX_VERSION_LABEL}={version}",
        "--label",
        f"{IOTBOX_RECIPE_LABEL}={RECIPE_DIGEST}",
        "--label",
        "traefik.enable=true",
        "--label",
        "traefik.http.routers.iotbox.entrypoints=web",
        "--label",
        f"traefik.http.routers.iotbox.rule=Host(`{IOTBOX_HOST}`)",
        "--label",
        "traefik.http.services.iotbox.loadbalancer.server.port=8069",
        "--env",
        f"IOTBOX_MODULES={IOTBOX_MODULES[version]}",
        "--volume",
        f"{volume_name(version)}:/home/pi",
        "--volume",
        "./odoo/odoo:/home/pi/odoo:ro",
        # Reliée à une base, la box y télécharge ses pilotes : en mémoire, jamais dans le code du projet,
        # remplie au démarrage avec ceux du projet (copie lue dans /home/pi/odoo-source).
        "--tmpfs",
        f"/home/pi/odoo/addons/{IOTBOX_MODULES[version].split(',')[0]}/iot_handlers",
        "--volume",
        "./odoo/odoo:/home/pi/odoo-source:ro",
        image_tag(version),
    ]


def pairing_token(project, db_name, token, db_uuid, enterprise_code):
    """Jeton au format d'Odoo 18+, accepté aussi par la box 17 : la box joint Odoo par le réseau Docker."""
    query = urlencode({"token": token, "db_uuid": db_uuid, "enterprise_code": enterprise_code, "db_name": db_name})
    return f"http://odoo-{project}:8069?{query}"


def connect_command(version, token):
    """Commande lancée dans la box : son serveur n'écoute que dans le conteneur pour cet appel."""
    payload = json.dumps({"jsonrpc": "2.0", "method": "call", "params": {"token": token}})
    return [
        "exec",
        IOTBOX_CONTAINER,
        "curl",
        "--silent",
        "--show-error",
        "--max-time",
        "20",
        "--header",
        "Content-Type: application/json",
        "--data",
        payload,
        f"http://127.0.0.1:8069{IOTBOX_CONNECT_ROUTES[version]}",
    ]


def connect_failure(output):
    """Raison d'un refus de la box, ou "" quand elle a accepté le jeton."""
    try:
        result = json.loads(output).get("result") or {}
    except (ValueError, AttributeError):
        return "La box n'a pas répondu à la demande de connexion."
    if result.get("status") == "success":
        return ""
    return str(result.get("message") or "La box a refusé la connexion.")
