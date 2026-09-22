#!/usr/bin/env sh
# Publie une Release GitLab pour un tag déjà compilé (typiquement via GitHub Actions /
# scripts/build_all_platforms.sh) : les installateurs sont hébergés sur le registre de
# paquets génériques du projet GitLab, puis reliés à la Release en pièces jointes.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DIST_ROOT="$ROOT/dist/all-platforms"
REMOTE=${GITLAB_REMOTE:-gitlab}
PACKAGE_NAME="sdk-local-manager"

TAG=""
SOURCE_DIR=""
DESCRIPTION="Installateurs macOS/Windows/Linux compilés via GitHub Actions."
HEADER_FILE=""

usage() {
  cat <<'EOF'
Publie une Release GitLab pour un tag déjà compilé ailleurs (GitHub Actions).

Usage:
  sh scripts/publish_gitlab_release.sh --tag NOM [options]

Options:
  --tag NOM          Tag à publier, par exemple app-v0.8.0-build3 (requis).
  --dir CHEMIN        Dossier contenant les installateurs, sous-dossiers inclus.
                       Par défaut : dist/all-platforms/<tag> (sortie de build_all_platforms.sh).
  --description TEXTE Description de la Release (par défaut : phrase générique).
  -h, --help           Affiche cette aide.

Pré-requis:
  - git, python3, curl
  - remote « gitlab » configuré (autre nom : GITLAB_REMOTE=nom)
  - GITLAB_TOKEN, jeton d'accès personnel GitLab avec le droit api (écriture,
    pas seulement read_api : la création de Release et l'upload de paquets l'exigent)
EOF
}

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf 'Erreur: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "commande requise introuvable: $1"
}

cleanup() {
  if [ -n "$HEADER_FILE" ]; then
    rm -f "$HEADER_FILE"
  fi
}
trap cleanup EXIT INT TERM

# Hôte et chemin du projet, lus dans l'URL du remote : ssh://git@hôte:port/groupe/projet.git,
# git@hôte:groupe/projet.git ou https://hôte/groupe/projet.git.
remote_project() {
  url=$(git -C "$ROOT" config --get "remote.$REMOTE.url" || true)
  [ -n "$url" ] || die "remote « $REMOTE » introuvable. Ajoute-le : git remote add $REMOTE ssh://git@gitlab.sudokeys.com:10022/cdp/sdk-local-manager.git"
  python3 - "$url" <<'PY'
import re
import sys

url = sys.argv[1]
match = (
    re.match(r"^ssh://[^@]+@([^:/]+)(?::\d+)?/(.+?)(?:\.git)?/?$", url)
    or re.match(r"^[^@]+@([^:]+):(.+?)(?:\.git)?/?$", url)
    or re.match(r"^https?://(?:[^@/]+@)?([^/]+)/(.+?)(?:\.git)?/?$", url)
)
if match:
    print(match.group(1), match.group(2))
PY
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      [ "$#" -ge 2 ] || die "--tag attend une valeur"
      TAG=$2
      shift 2
      ;;
    --dir)
      [ "$#" -ge 2 ] || die "--dir attend une valeur"
      SOURCE_DIR=$2
      shift 2
      ;;
    --description)
      [ "$#" -ge 2 ] || die "--description attend une valeur"
      DESCRIPTION=$2
      shift 2
      ;;
    -h | --help) usage; exit 0 ;;
    *) die "option inconnue: $1" ;;
  esac
done

[ -n "$TAG" ] || die "--tag est requis"
[ -n "${GITLAB_TOKEN:-}" ] || die "GITLAB_TOKEN est requis (droit api, en écriture)"
[ -n "$SOURCE_DIR" ] || SOURCE_DIR="$DIST_ROOT/$TAG"
[ -d "$SOURCE_DIR" ] || die "dossier introuvable: $SOURCE_DIR (lance d'abord scripts/build_all_platforms.sh --tag $TAG)"

require_cmd git
require_cmd python3
require_cmd curl

project=$(remote_project)
[ -n "$project" ] || die "URL du remote $REMOTE non reconnue : $(git config --get "remote.$REMOTE.url")"
host=${project%% *}
project_path=${project#* }
WEB_URL="https://$host/$project_path"
API="${GITLAB_URL:-https://$host}/api/v4/projects/$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$project_path")"

HEADER_FILE=$(mktemp)
chmod 600 "$HEADER_FILE"
printf 'PRIVATE-TOKEN: %s\n' "$GITLAB_TOKEN" >"$HEADER_FILE"

files=$(find "$SOURCE_DIR" -type f | sort)
[ -n "$files" ] || die "aucun fichier trouvé dans $SOURCE_DIR"

log "Fichiers à publier"
printf '%s\n' "$files"

filenames=""
for file in $files; do
  name=$(basename "$file")
  filenames="$filenames $name"
  log "Upload $name vers le registre de paquets génériques"
  curl -fsS --retry 3 -H "@$HEADER_FILE" --upload-file "$file" \
    "$API/packages/generic/$PACKAGE_NAME/$TAG/$name" >/dev/null
done

log "Publication de la Release $TAG"
# shellcheck disable=SC2086
release_payload=$(python3 - "$TAG" "$DESCRIPTION" "$API" "$PACKAGE_NAME" $filenames <<'PY'
import json
import sys

tag, description, api, package_name, *filenames = sys.argv[1:]
links = [
    {
        "name": name,
        "url": f"{api}/packages/generic/{package_name}/{tag}/{name}",
        "link_type": "package",
    }
    for name in filenames
]
print(json.dumps({"tag_name": tag, "name": tag, "description": description, "assets": {"links": links}}))
PY
)

if curl -fsS -X POST -H "@$HEADER_FILE" -H "Content-Type: application/json" \
  -d "$release_payload" "$API/releases" >/dev/null; then
  :
else
  log "Release déjà existante, mise à jour"
  curl -fsS -X PUT -H "@$HEADER_FILE" -H "Content-Type: application/json" \
    -d "$release_payload" "$API/releases/$TAG" >/dev/null
fi

printf 'Release: %s/-/releases/%s\n' "$WEB_URL" "$TAG"
