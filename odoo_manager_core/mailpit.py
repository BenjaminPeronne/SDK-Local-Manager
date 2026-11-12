"""Mailpit : capture locale des e-mails, partagée par tous les projets.

Les bases neutralisées envoient leurs e-mails vers `mailpit:1025` sur le réseau de Traefik ; on les lit
sur mail.localhost. Ici, la recette du conteneur ; son démarrage passe par les actions du serveur.
"""

MAILPIT_CONTAINER = "mailpit"
MAILPIT_IMAGE = "axllent/mailpit:v1.31"
# Empreinte de l'index multi-architecture de v1.31 : une image republiée sous le même tag chez
# l'éditeur est refusée au lieu d'être installée. Docker ne nomme pas une image téléchargée
# par empreinte : elle reçoit ensuite le tag, que le reste de l'application reconnaît.
MAILPIT_IMAGE_DIGEST = "sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d"
MAILPIT_PINNED_IMAGE = f"axllent/mailpit@{MAILPIT_IMAGE_DIGEST}"
MAILPIT_HOST = "mail.localhost"


def status_message(state, traefik_running):
    """Phrase affichée sous Mailpit selon l'état de son conteneur."""
    if state == "running":
        return "Les e-mails de tes bases neutralisées arrivent ici, sans partir chez personne."
    if not traefik_running:
        return "Démarre d'abord Traefik pour pouvoir installer Mailpit."
    if state == "absent":
        return "Installe-le pour voir les e-mails envoyés par tes bases neutralisées."
    return "Mailpit est arrêté : démarre-le pour voir les e-mails."


def run_arguments(network):
    """`docker run` du premier démarrage, sur le réseau de Traefik."""
    return [
        "run",
        "--detach",
        "--name",
        MAILPIT_CONTAINER,
        "--restart",
        "unless-stopped",
        "--network",
        network,
        "--env",
        "MP_MAX_MESSAGES=5000",
        # Les serveurs SMTP copiés d'une base client peuvent tenter une authentification.
        "--env",
        "MP_SMTP_AUTH_ACCEPT_ANY=1",
        "--env",
        "MP_SMTP_AUTH_ALLOW_INSECURE=1",
        "--label",
        "traefik.enable=true",
        "--label",
        "traefik.http.routers.mailpit.entrypoints=web",
        "--label",
        f"traefik.http.routers.mailpit.rule=Host(`{MAILPIT_HOST}`)",
        "--label",
        "traefik.http.services.mailpit.loadbalancer.server.port=8025",
        MAILPIT_IMAGE,
    ]
