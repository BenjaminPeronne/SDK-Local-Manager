"""Accès mobile : ouvre un seul projet Odoo aux appareils du même Wi-Fi.

Un relais vers le seul conteneur Odoo choisi : Traefik reste réservé à ce poste, le téléphone ne pouvant pas
résoudre les adresses *.localhost. Pas de redémarrage automatique : l'accès se referme avec Docker. Le nom ne
commence pas par « odoo- », réservé aux conteneurs des projets (un projet peut s'appeler « mobile »).
"""

import hashlib

MOBILE_CONTAINER = "mobile-access"
MOBILE_IMAGE = "nginx@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236"  # 1.28.3-alpine
MOBILE_PORT = 8069
MOBILE_PROJECT_LABEL = "odoo-manager.mobile.project"
MOBILE_URL_LABEL = "odoo-manager.mobile.url"
MOBILE_RECIPE_LABEL = "odoo-manager.mobile.recipe"

# Le Wi-Fi n'est pas ce poste : la gestion des bases d'Odoo (sauvegarde, suppression, duplication) et ses
# API par programme restent fermées, son mot de passe maître étant souvent celui par défaut. Le QR code
# ouvre /web?db=… et n'en a pas besoin. nginx décode l'adresse avant de la comparer : /web%2Fdatabase est refusé.
NGINX_CONF = """\
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
server {
    listen MOBILE_PORT;
    client_max_body_size 200m;
    # Docker DNS relu : un conteneur Odoo redémarré change d'adresse.
    resolver 127.0.0.11 valid=10s ipv6=off;
    set $odoo http://odoo-PROJECT:MOBILE_PORT;
    location ~* ^/(web/database/|jsonrpc|xmlrpc) {
        return 403 "Gestion des bases fermee depuis le Wi-Fi : utilise le poste.";
    }
    location / {
        proxy_pass $odoo;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 720s;
    }
}
"""
# Change avec l'image ou la config : un relais ouvert par une version précédente est refait.
RECIPE = hashlib.sha256(f"{MOBILE_IMAGE}\0{NGINX_CONF}".encode()).hexdigest()[:12]
# Format de `docker inspect` qui relit (projet, adresse, recette) sur le conteneur ouvert.
OWNER_FORMAT = "|".join(
    f'{{{{index .Config.Labels "{label}"}}}}' for label in (MOBILE_PROJECT_LABEL, MOBILE_URL_LABEL, MOBILE_RECIPE_LABEL)
)


def access_url(ip):
    return f"http://{ip}:{MOBILE_PORT}/"


def parse_owner(code, output):
    """(projet, adresse, recette) lus par `docker inspect` avec OWNER_FORMAT, vides s'ils sont illisibles."""
    return tuple(output.strip().split("|")) if code == 0 and output.count("|") == 2 else ("", "", "")


def nginx_conf(project):
    return NGINX_CONF.replace("MOBILE_PORT", str(MOBILE_PORT)).replace("PROJECT", project)


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
        "--label",
        f"{MOBILE_RECIPE_LABEL}={RECIPE}",
        "--env",
        f"MOBILE_NGINX_CONF={nginx_conf(project)}",
        "--entrypoint",
        "sh",
        MOBILE_IMAGE,
        "-c",
        'printf "%s" "$MOBILE_NGINX_CONF" > /etc/nginx/conf.d/default.conf && exec nginx -g "daemon off;"',
    ]
