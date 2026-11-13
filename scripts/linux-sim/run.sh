#!/usr/bin/env bash
# Démarre un poste Linux simulé (Docker-in-Docker) et son backend sur http://127.0.0.1:18899.
#   scripts/linux-sim/run.sh          démarre (ou redémarre le backend)
#   scripts/linux-sim/run.sh shell    ouvre un shell dans le poste
#   scripts/linux-sim/run.sh stop     supprime le poste et ses projets de test
# Jeton API : contenu de scripts/linux-sim/.token (créé au premier lancement, ignoré par git).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
name=sdk-linux-sim

case "${1:-start}" in
  stop) docker rm -f "$name" >/dev/null 2>&1; docker volume rm "$name-docker" >/dev/null 2>&1 || true; exit 0 ;;
  shell) exec docker exec -it "$name" bash ;;
esac

[ -s "$here/.token" ] || openssl rand -hex 24 > "$here/.token"
docker build -q -t "$name" "$here" >/dev/null
if ! docker container inspect "$name" >/dev/null 2>&1; then
  # Volume nommé pour /var/lib/docker : les images Odoo survivent à un redémarrage du poste.
  docker run -d --privileged --name "$name" -p 127.0.0.1:18899:18799 \
    -v "$repo:/app:ro" -v "$name-docker:/var/lib/docker" "$name" >/dev/null
fi
docker start "$name" >/dev/null
until docker exec "$name" docker info >/dev/null 2>&1; do sleep 1; done
docker exec "$name" pkill -f odoo_manager_web.py >/dev/null 2>&1 || true
docker exec -d -e ODOO_MANAGER_API_TOKEN="$(cat "$here/.token")" -e HOME=/home/dev -w /app "$name" \
  su-exec dev sh -c 'python3 -u odoo_manager_web.py > /tmp/backend.log 2>&1'
echo "Backend Linux simulé : http://127.0.0.1:18899 (jeton dans $here/.token)"
