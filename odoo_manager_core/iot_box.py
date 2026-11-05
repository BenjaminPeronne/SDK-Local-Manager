"""IoT Box virtuelle : le code IoT d'Odoo dans un conteneur, à côté des projets.

Une seule box sur la machine, comme une vraie IoT Box reliée à une base à la fois. Elle tourne
avec le code Odoo du projet choisi, donc dans sa version : changer de projet recrée le conteneur.
La configuration de la box (base reliée, numéro de série) reste dans un volume par version.

Le code IoT 17.0 et 18.0 est écrit pour le Raspberry Pi (sudo, dépôt git dans /home/pi/odoo,
numéro de série dans /sys) : l'image en reproduit juste assez. Celui de 19.0 a un mode « Test »
prévu pour tourner ailleurs que sur un Pi.
"""

import hashlib
from pathlib import Path

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
COPY sudo git /usr/local/bin/
COPY entrypoint.sh /usr/local/bin/iotbox-entrypoint
COPY sitecustomize.py /tmp/sitecustomize.py
RUN chmod +x /usr/local/bin/sudo /usr/local/bin/git /usr/local/bin/iotbox-entrypoint \\
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
# Le code IoT 17/18 lit et met à jour son dépôt /home/pi/odoo : ici le code du projet, en lecture seule.
case "$*" in *--git-dir=/home/pi/odoo/.git*) echo 0000000; exit 0;; esac
exec /usr/bin/git "$@"
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
# Change avec la recette : une image construite avant une mise à jour du gestionnaire est refaite.
RECIPE_DIGEST = hashlib.sha256("\0".join(f"{k}\0{v}" for k, v in sorted(BUILD_FILES.items())).encode()).hexdigest()[:12]


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
        image_tag(version),
    ]
