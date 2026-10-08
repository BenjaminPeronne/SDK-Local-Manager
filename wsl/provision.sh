#!/bin/sh
# Prépare la distribution SDK-Manager, ou la met à niveau après une mise à jour de
# l'application. Exécuté comme root par le gestionnaire (wsl -u root), à chaque
# démarrage quand la version installée diffère de celle de l'application.
#
# Rejouable sans risque : chaque étape vérifie l'état avant d'agir et ne touche
# jamais aux projets ni aux bases.
set -eu

SDK_USER=${SDK_USER:-sdk}
SDK_HOME=$(getent passwd "$SDK_USER" | cut -d: -f6)
SDK_HOME=${SDK_HOME:-/home/$SDK_USER}
WORKSPACE=${SDK_WORKSPACE:-$SDK_HOME/Odoo-projects}
RELEASE_FILE=/etc/sdk-manager-release
VERSION=${SDK_MANAGER_VERSION:-}

log() { printf '%s\n' "$*"; }

log "Provisionnement de SDK-Manager (version demandée: ${VERSION:-inconnue})."

if [ ! -d "$SDK_HOME" ]; then
    log "Utilisateur $SDK_USER sans dossier personnel : environnement inattendu." >&2
    exit 1
fi

install -d -o "$SDK_USER" -g "$SDK_USER" -m 0755 "$WORKSPACE"
install -d -o "$SDK_USER" -g "$SDK_USER" -m 0700 "$SDK_HOME/.ssh"
install -d -m 0755 /opt/sdk-manager

# Docker doit être démarré et le rester : les projets en dépendent. Un Docker arrêté fait
# échouer le provisionnement : le gestionnaire redémarre alors l'environnement et réessaie, au
# lieu d'annoncer un poste prêt qui échouerait à la création du premier projet. La version
# n'est pas enregistrée, donc le prochain démarrage réessaie aussi.
if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
    log "systemd absent : vérifier [boot] systemd=true dans /etc/wsl.conf." >&2
    exit 1
fi
systemctl enable docker >/dev/null 2>&1 || true
systemctl start docker >/dev/null 2>&1 || true
# Le démon peut mettre quelques secondes à répondre après `systemctl start`.
attempt=0
until systemctl is-active --quiet docker && docker info >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
        log "Docker n'a pas démarré après 60 secondes." >&2
        journalctl -u docker -n 20 --no-pager 1>&2 2>/dev/null || true
        exit 1
    fi
    sleep 2
done

# L'utilisateur doit pouvoir parler au démon sans sudo.
if ! id -nG "$SDK_USER" | tr ' ' '\n' | grep -qx docker; then
    usermod -aG docker "$SDK_USER"
    log "Utilisateur $SDK_USER ajouté au groupe docker."
fi

if [ -n "$VERSION" ]; then
    printf '%s\n' "$VERSION" > "$RELEASE_FILE"
fi

log "Provisionnement terminé."
