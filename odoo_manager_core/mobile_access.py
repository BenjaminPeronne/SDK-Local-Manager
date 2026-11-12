"""Accès mobile : ouvre un seul projet Odoo aux appareils du même Wi-Fi.

Une porte vers le seul conteneur Odoo choisi : Traefik reste réservé à ce poste, le téléphone ne pouvant pas
résoudre les adresses *.localhost. Pas de redémarrage automatique : l'accès se referme avec Docker. Le nom ne
commence pas par « odoo- », réservé aux conteneurs des projets (un projet peut s'appeler « mobile »).
"""

MOBILE_CONTAINER = "mobile-access"
MOBILE_IMAGE = "alpine/socat@sha256:beb4a68d9e4fe6b0f21ea774a0fde6c31f580dde6368939ed70100c5385b015e"  # 1.8.0.3
MOBILE_PORT = 8069
MOBILE_PROJECT_LABEL = "odoo-manager.mobile.project"
MOBILE_URL_LABEL = "odoo-manager.mobile.url"
# Format de `docker inspect` qui relit (projet, adresse) sur le conteneur ouvert.
OWNER_FORMAT = (
    f'{{{{index .Config.Labels "{MOBILE_PROJECT_LABEL}"}}}}|{{{{index .Config.Labels "{MOBILE_URL_LABEL}"}}}}'
)


def access_url(ip):
    return f"http://{ip}:{MOBILE_PORT}/"


def parse_owner(code, output):
    """(projet, adresse) lus par `docker inspect` avec OWNER_FORMAT, ("", "") s'ils sont illisibles."""
    return tuple(output.strip().split("|")) if code == 0 and output.count("|") == 1 else ("", "")


def run_arguments(project, ip, network):
    """`docker run` d'un relais publié sur la seule adresse Wi-Fi du poste, vers le conteneur Odoo du projet."""
    return [
        "run",
        "--detach",
        "--rm",
        "--name",
        MOBILE_CONTAINER,
        "--network",
        network,
        "--publish",
        f"{ip}:{MOBILE_PORT}:{MOBILE_PORT}",
        "--label",
        f"{MOBILE_PROJECT_LABEL}={project}",
        "--label",
        f"{MOBILE_URL_LABEL}={access_url(ip)}",
        MOBILE_IMAGE,
        f"TCP-LISTEN:{MOBILE_PORT},fork,reuseaddr",
        f"TCP:odoo-{project}:{MOBILE_PORT}",
    ]
