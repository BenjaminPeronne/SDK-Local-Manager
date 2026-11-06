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
import re
import socket
from pathlib import Path
from urllib.parse import urlencode

IOTBOX_CONTAINER = "iotbox"
IOTBOX_IMAGE = "odoo-manager-iotbox"
IOTBOX_HOST = "iot.localhost"
# Les terminaux de paiement Ingenico se connectent à la box sur ce port.
IOTBOX_TERMINAL_PORT = 9000
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
    pyudev evdev polib zeroconf dbus-python --config-settings=setup-args=-Dtests=false
RUN id pi >/dev/null 2>&1 || useradd -M -d /home/pi pi
COPY sudo /usr/local/bin/
COPY git /usr/bin/git
COPY nmcli /usr/bin/nmcli
COPY inactive /usr/bin/systemctl
COPY inactive /usr/bin/wlr-randr
RUN mv /usr/lib/cups/backend/socket /usr/lib/cups/socket-real
COPY socket_backend.py /usr/lib/cups/backend/socket
COPY entrypoint.sh /usr/local/bin/iotbox-entrypoint
COPY lan_scan.py /usr/local/bin/iotbox-lan-scan
COPY sitecustomize.py /tmp/sitecustomize.py
RUN chmod +x /usr/local/bin/sudo /usr/bin/git /usr/bin/nmcli /usr/bin/systemctl /usr/bin/wlr-randr /usr/lib/cups/backend/socket /usr/local/bin/iotbox-entrypoint \\
 && mv /tmp/sitecustomize.py "$("$PYTHON_VENV_PATH/bin/python" -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])')/" \\
 && mkdir -p /var/odoo /root_bypass_ramdisks/etc/ssl/certs /root_bypass_ramdisks/etc/ssl/private /root_bypass_ramdisks/etc/ld.so.conf.d \\
 && echo 24.10 > /var/odoo/iotbox_version && echo "IoT Box virtuelle" > /var/odoo/device-model
EXPOSE 8069
ENTRYPOINT ["/usr/local/bin/iotbox-entrypoint"]
"""

SUDO_SHIM = """\
#!/bin/sh
# Le code IoT du Raspberry Pi remonte le disque, relance nginx, renomme la machine : sans objet ici.
case "$1" in mount|service|systemctl|hostname|reboot|chmod|chown|chroot|chpasswd|rsync|bash) exit 0;; esac
exec "$@"
"""

GIT_SHIM = """\
#!/bin/sh
# Le code IoT 17/18 se met à jour par git (fetch, reset, clean) dans /home/pi/odoo, qui est ici le code du
# projet : git ne fait rien dans la box. Sans réponse à `ls-remote`, la box saute sa mise à jour.
exit 0
"""

NMCLI_SHIM = """\
#!/bin/sh
# La page de la box 19 interroge le wifi du Raspberry Pi : la box n'en a pas, le réseau passe par Docker.
exit 0
"""

INACTIVE_SHIM = """\
#!/bin/sh
# Services (wifi en point d'accès) et écrans du Raspberry Pi, absents ici : répondre « inactif » et jamais « actif ».
exit 3
"""

SOCKET_BACKEND = """\
#!/home/_venv/bin/python -IS
# Odoo envoie toujours un ticket de caisse en image ESC/POS, qu'une imprimante ZPL (Zebra) ne sait pas lire :
# CUPS annonce un envoi réussi et rien ne sort. On le traduit en ZPL juste avant le vrai envoi.
import os
import subprocess
import sys
import tempfile

SOCKET = "/usr/lib/cups/socket-real"
RASTER = b"\\x1d\\x76\\x30\\x00"  # commande ESC/POS « GS v 0 » : une tranche d'image


def zpl_from_raster(data):
    \"\"\"ZPL d'une image en tranches « GS v 0 », ou les données telles quelles si ce n'en est pas une.\"\"\"
    position, width, height, dots = 0, 0, 0, b""
    while data[position : position + 4] == RASTER:
        width = int.from_bytes(data[position + 4 : position + 6], "little")
        rows = int.from_bytes(data[position + 6 : position + 8], "little")
        position += 8
        dots += data[position : position + width * rows]
        position += width * rows
        height += rows
    if not dots:
        return data
    # ^PW et ^LL valent pour ce seul envoi : les réglages enregistrés dans l'imprimante ne changent pas.
    size = len(dots)
    return f"^XA^PW{width * 8}^LL{height}^FO0,0^GFA,{size},{size},{width},{dots.hex().upper()}^FS^XZ".encode()


def main():
    if len(sys.argv) < 6 or "ZPL" not in os.environ.get("PRINTER_INFO", ""):
        os.execv(SOCKET, sys.argv)
    if len(sys.argv) > 6:
        with open(sys.argv[6], "rb") as job:
            data = job.read()
    else:
        data = sys.stdin.buffer.read()
    with tempfile.NamedTemporaryFile() as job:
        job.write(zpl_from_raster(data))
        job.flush()
        sys.exit(subprocess.run([SOCKET, *sys.argv[1:6], job.name], check=False).returncode)


if __name__ == "__main__":
    main()
"""

SITECUSTOMIZE = """\
import builtins
import pathlib
import platform

# Hors Raspberry Pi, le code IoT 19 passe en mode « Test », qui ne charge aucun pilote ni aucune interface.
_release = platform.release
platform.release = lambda: f"{_release()}-rpi"

# Le code IoT lit des fichiers du Raspberry Pi, que Docker masque : on lit ceux de la box.
_PI_FILES = {
    "/sys/firmware/devicetree/base/serial-number": "/home/pi/serial-number",
    "/proc/device-tree/model": "/var/odoo/device-model",
}


def _redirect(method):
    def wrapper(self, *args, **kwargs):
        return method(pathlib.Path(_PI_FILES.get(str(self), self)), *args, **kwargs)

    return wrapper


pathlib.Path.exists = _redirect(pathlib.Path.exists)
pathlib.Path.open = _redirect(pathlib.Path.open)
_open = builtins.open
builtins.open = lambda file, *args, **kwargs: _open(_PI_FILES.get(file, file), *args, **kwargs)


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

LAN_SCAN = """\
# Docker Desktop ne laisse passer ni multicast ni diffusion : la recherche d'imprimantes de CUPS ne voit
# pas le réseau local. Une connexion directe passe : on y cherche les ports d'impression, puis CUPS
# interroge chaque adresse trouvée (SNMP) et la box les remonte comme une vraie.
import concurrent.futures
import os
import pathlib
import socket
import time

LAN = os.environ.get("IOTBOX_LAN")
PORTS = (9100, 631, 515)
known = set()


def answers(address):
    with socket.socket() as probe:
        probe.settimeout(1)
        return probe.connect_ex(address) == 0


while LAN:
    addresses = [(f"{LAN}.{host}", port) for host in range(1, 255) for port in PORTS]
    with concurrent.futures.ThreadPoolExecutor(128) as pool:
        # Une adresse trouvée le reste : une imprimante en veille ne doit pas disparaître d'Odoo.
        known |= {address[0] for address, found in zip(addresses, pool.map(answers, addresses)) if found}
    lines = [f"Address {ip}" for ip in sorted(known)] + ["Community public"]
    pathlib.Path("/etc/cups/snmp.conf").write_text("\\n".join(lines) + "\\n")
    time.sleep(60)
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
python /usr/local/bin/iotbox-lan-scan &
# Le premier balayage doit finir avant la première détection : en 17/18 la suivante attend 2 minutes.
sleep 8
handlers="addons/${IOTBOX_MODULES%%,*}/iot_handlers"
cp -a "/home/pi/odoo-source/$handlers/." "/home/pi/odoo/$handlers/"
cd /home/pi/odoo
# La page de la box lit ce journal ; Docker garde le sien.
mkdir -p /var/log/odoo
exec python odoo-bin -c /home/pi/odoo.conf --http-port=8069 --load="$IOTBOX_MODULES" > >(tee /var/log/odoo/odoo-server.log) 2>&1
"""

BUILD_FILES = {
    "Dockerfile": DOCKERFILE,
    "sudo": SUDO_SHIM,
    "git": GIT_SHIM,
    "nmcli": NMCLI_SHIM,
    "inactive": INACTIVE_SHIM,
    "socket_backend.py": SOCKET_BACKEND,
    "sitecustomize.py": SITECUSTOMIZE,
    "entrypoint.sh": ENTRYPOINT,
    "lan_scan.py": LAN_SCAN,
}
# Change avec la recette : une image ou une box d'avant une mise à jour du gestionnaire est refaite.
# À changer quand `run_arguments` change : une box lancée autrement est alors recréée.
RUN_LAYOUT = "5"
RECIPE_DIGEST = hashlib.sha256(
    "\0".join([RUN_LAYOUT, *(f"{k}\0{v}" for k, v in sorted(BUILD_FILES.items()))]).encode()
).hexdigest()[:12]


def local_ip():
    """Adresse du poste sur le réseau local, "" sans réseau."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("192.0.2.1", 9))  # UDP : rien n'est envoyé, le système choisit juste l'interface
        except OSError:
            return ""
        return probe.getsockname()[0]


def local_lan():
    """Réseau local du poste (« 192.168.1 »).

    shortcut: suppose un réseau en /24 et le poste sur un seul réseau, à élargir au masque réel si besoin.
    """
    return local_ip().rpartition(".")[0]


def box_recipe(lan, terminal_port):
    """Repère d'une box : réseau balayé et port publié sont fixés à sa création, les changer la recrée."""
    return f"{RECIPE_DIGEST}:{lan}:{IOTBOX_TERMINAL_PORT if terminal_port else ''}"


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


def run_arguments(project, version, network, lan, terminal_port):
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
        f"{IOTBOX_RECIPE_LABEL}={box_recipe(lan, terminal_port)}",
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
        "--env",
        f"IOTBOX_LAN={lan}",
        "--volume",
        f"{volume_name(version)}:/home/pi",
        "--volume",
        "./odoo/odoo:/home/pi/odoo:ro",
        # Reliée à une base, la box y télécharge ses pilotes : en mémoire, jamais dans le code du projet,
        # remplie au démarrage avec ceux du projet (copie lue dans /home/pi/odoo-source).
        *(["--publish", f"{IOTBOX_TERMINAL_PORT}:{IOTBOX_TERMINAL_PORT}"] if terminal_port else []),
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


def box_identifiers(networks, serial):
    """Valeurs SQL des identifiants possibles de la box, tirées de sa sortie `docker inspect` et de son volume."""
    found = {*re.findall(r"(?:[0-9a-f]{2}:){5}[0-9a-f]{2}", networks.lower()), *re.findall(r"SDK[0-9a-f]+", serial)}
    return ", ".join(f"'{value}'" for value in sorted(found)) or "''"
