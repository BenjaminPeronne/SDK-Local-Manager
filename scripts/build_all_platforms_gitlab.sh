#!/usr/bin/env sh
# Compile SDK Local Manager pour les trois plateformes avec GitLab CI (.gitlab-ci.yml).
# Pendant de scripts/build_all_platforms.sh, qui reste la voie GitHub Actions.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DIST_ROOT="$ROOT/dist/all-platforms"
VERSION_FILE="$ROOT/odoo-manager-next/package.json"
REMOTE=${GITLAB_REMOTE:-gitlab}
POLL_SECONDS=15

RUN_CHECKS=1
LOCAL_BUILD=0
WAIT_FOR_CI=1
DOWNLOAD_ARTIFACTS=1
CLEAN_AFTER_CHECKS=1
TAG=""
HEADER_FILE=""

usage() {
  cat <<'EOF'
Compile SDK Local Manager pour toutes les plateformes avec GitLab CI.

  - checks locaux : Python + tests + build Next.js
  - build multi-plateformes : pipeline GitLab déclenché par un tag app-v*
  - suivi et téléchargement des installateurs : automatiques si GITLAB_TOKEN est défini

Usage:
  sh scripts/build_all_platforms_gitlab.sh [options]

Options:
  --tag NOM              Force un tag précis, par exemple app-v0.8.0.
  --local                Compile aussi la plateforme courante en local.
  --skip-checks          Ne lance pas py_compile, unittest et npm run build.
  --no-wait              Ne suit pas le pipeline GitLab.
  --no-download          Ne télécharge pas les installateurs.
  --no-clean             Conserve .next et les caches générés par les checks.
  -h, --help             Affiche cette aide.

Pré-requis:
  - git, python3, npm, curl, unzip
  - remote « gitlab » configuré (autre nom : GITLAB_REMOTE=nom)
  - droits de push sur le projet GitLab
  - recommandé : GITLAB_TOKEN, jeton d'accès personnel GitLab avec le droit read_api,
    pour suivre le pipeline et télécharger les installateurs

Sorties:
  - Installateurs téléchargés dans dist/all-platforms/<tag>/<job>/.
  - Sans --tag, le prochain tag app-v<version>-buildN est calculé automatiquement, sans
    réutiliser un numéro déjà pris sur GitHub ou sur GitLab.
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

run() {
  printf '+'
  for arg in "$@"; do
    printf ' %s' "$arg"
  done
  printf '\n'
  "$@"
}

cleanup() {
  if [ -n "$HEADER_FILE" ]; then
    rm -f "$HEADER_FILE"
  fi
}
trap cleanup EXIT INT TERM

clean_generated_files() {
  rm -rf "$ROOT/__pycache__" \
    "$ROOT/odoo_manager_core/__pycache__" \
    "$ROOT/tests/__pycache__" \
    "$ROOT/odoo-manager-next/.next" \
    "$ROOT/odoo-manager-next/tsconfig.tsbuildinfo"
}

package_version() {
  python3 - "$VERSION_FILE" <<'PY'
import json
import sys
from pathlib import Path

try:
    print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("version") or "0.0.0")
except Exception:
    print("0.0.0")
PY
}

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

# Le pipeline compile le commit du tag : une branche en retard ou en avance sur GitLab
# produirait un installateur qui ne correspond pas au code local, sans aucune erreur.
check_branch_synchronized() {
  branch=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)
  [ "$branch" != "HEAD" ] || die "HEAD est détaché : place-toi sur une branche avant de construire."
  git -C "$ROOT" fetch --quiet "$REMOTE" || die "impossible de contacter $REMOTE pour vérifier que $branch est à jour."
  upstream="$REMOTE/$branch"
  git -C "$ROOT" rev-parse -q --verify "refs/remotes/$upstream" >/dev/null \
    || die "la branche $branch n'existe pas sur $REMOTE. Pousse-la d'abord : git push $REMOTE $branch"
  behind=$(git -C "$ROOT" rev-list --count "HEAD..$upstream")
  ahead=$(git -C "$ROOT" rev-list --count "$upstream..HEAD")
  [ "$behind" = "0" ] || die "$branch est en retard de $behind commit(s) sur $upstream. Mets-la à jour : git pull $REMOTE $branch"
  [ "$ahead" = "0" ] || die "$branch a $ahead commit(s) non poussé(s) vers $upstream. Pousse-les : git push $REMOTE $branch"
  printf 'Branche %s synchronisée avec %s.\n' "$branch" "$upstream"
}

# Numérotation commune aux deux CI : un numéro déjà pris sur GitHub ou sur GitLab n'est pas réutilisé.
next_build_tag() {
  prefix="app-v$1-build"
  max_build=0
  tags=$(git tag --list "${prefix}*")
  for remote in $(git remote); do
    tags="$tags $(git ls-remote --tags "$remote" "refs/tags/${prefix}*" 2>/dev/null \
      | awk '{print $2}' | sed 's#refs/tags/##; s/\^{}$//' || true)"
  done
  for existing_tag in $tags; do
    build_number=${existing_tag#"$prefix"}
    case "$build_number" in
      '' | *[!0-9]*) continue ;;
    esac
    if [ "$build_number" -gt "$max_build" ]; then
      max_build=$build_number
    fi
  done
  printf '%s%s\n' "$prefix" "$((max_build + 1))"
}

# Appel de l'API GitLab. Le jeton passe par un fichier d'en-têtes, jamais par la ligne de
# commande, où la liste des processus l'exposerait.
gitlab_api() {
  curl -fsS --retry 3 -H "@$HEADER_FILE" "$API/$1"
}

# Extrait une valeur de la réponse JSON lue sur l'entrée standard ; `d` désigne la réponse.
json_field() {
  python3 -c "import json, sys; d = json.load(sys.stdin); print(($1) or '')"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      [ "$#" -ge 2 ] || die "--tag attend une valeur"
      TAG=$2
      shift 2
      ;;
    --local) LOCAL_BUILD=1; shift ;;
    --skip-checks) RUN_CHECKS=0; shift ;;
    --no-wait) WAIT_FOR_CI=0; shift ;;
    --no-download) DOWNLOAD_ARTIFACTS=0; shift ;;
    --no-clean) CLEAN_AFTER_CHECKS=0; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "option inconnue: $1" ;;
  esac
done

cd "$ROOT"

require_cmd git
require_cmd python3
require_cmd npm
require_cmd curl

[ -f "$ROOT/.gitlab-ci.yml" ] || die "pipeline introuvable: .gitlab-ci.yml"
[ -f "$ROOT/scripts/build_desktop.py" ] || die "script introuvable: scripts/build_desktop.py"

project=$(remote_project)
[ -n "$project" ] || die "URL du remote $REMOTE non reconnue : $(git config --get "remote.$REMOTE.url")"
host=${project%% *}
project_path=${project#* }
WEB_URL="https://$host/$project_path"
API="${GITLAB_URL:-https://$host}/api/v4/projects/$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$project_path")"

version=$(package_version)
if [ -z "$TAG" ]; then
  TAG=$(next_build_tag "$version")
  printf 'Prochain numéro de build détecté: %s\n' "$TAG"
fi
case "$TAG" in
  app-v*) ;;
  *) die "le tag doit commencer par app-v pour déclencher le pipeline: $TAG" ;;
esac
tag_version=${TAG#app-v}
tag_version=${tag_version%%-*}
[ "$tag_version" = "$version" ] \
  || die "version incohérente: l'app est en $version mais le tag demandé est $TAG. Utilise app-v${version} pour une version stable."

check_branch_synchronized

# next-env.d.ts est réécrit par `next dev` : ce n'est pas un vrai changement.
if ! git diff --quiet -- . ':!dist' ':!odoo-manager-next/next-env.d.ts' \
  || ! git diff --cached --quiet -- . ':!dist' ':!odoo-manager-next/next-env.d.ts' \
  || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  printf 'Erreur: le dépôt contient des changements non commités.\n\n' >&2
  git status --short >&2
  printf '\nGitLab CI compile uniquement l état poussé sur GitLab : commite et pousse, puis relance.\n' >&2
  exit 1
fi

if [ "$RUN_CHECKS" -eq 1 ]; then
  log "Checks locaux"
  run python3 -m py_compile odoo_manager_web.py odoo_manager_core/system.py odoo_manager_core/platform.py
  run python3 -m unittest discover -s tests -v
  (cd "$ROOT/odoo-manager-next" && run npm run build)
fi

if [ "$CLEAN_AFTER_CHECKS" -eq 1 ]; then
  log "Nettoyage des fichiers temporaires"
  clean_generated_files
fi

if [ "$LOCAL_BUILD" -eq 1 ]; then
  log "Build local de la plateforme courante"
  export ODOO_MANAGER_BUILD_TAG="$TAG"
  run sh "$ROOT/scripts/build_local_desktop.sh"
fi

HEAD_SHA=$(git rev-parse HEAD)

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  existing_sha=$(git rev-parse "refs/tags/$TAG^{commit}")
  [ "$existing_sha" = "$HEAD_SHA" ] \
    || die "le tag $TAG existe déjà localement mais pointe sur un autre commit ($existing_sha)"
  log "Tag $TAG déjà présent localement sur ce commit, réutilisation"
else
  log "Création du tag $TAG"
  run git tag "$TAG" "$HEAD_SHA"
fi

log "Push du tag vers $REMOTE"
run git push "$REMOTE" "refs/tags/$TAG"
printf 'Pipelines GitLab: %s/-/pipelines\n' "$WEB_URL"

if [ -z "${GITLAB_TOKEN:-}" ]; then
  log "GITLAB_TOKEN absent"
  printf 'Le build est lancé par le tag %s.\n' "$TAG"
  printf 'Pour suivre le pipeline et télécharger les installateurs automatiquement, crée un jeton\n'
  printf 'd accès personnel (droit read_api) : %s/-/user_settings/personal_access_tokens\n' "https://$host"
  printf 'puis relance avec : GITLAB_TOKEN=... sh scripts/build_all_platforms_gitlab.sh --tag %s --skip-checks\n' "$TAG"
  exit 0
fi

HEADER_FILE=$(mktemp)
chmod 600 "$HEADER_FILE"
printf 'PRIVATE-TOKEN: %s\n' "$GITLAB_TOKEN" >"$HEADER_FILE"

log "Recherche du pipeline GitLab"
pipeline_id=""
i=0
while [ "$i" -lt 30 ]; do
  pipeline_id=$(gitlab_api "pipelines?ref=$TAG&sha=$HEAD_SHA&per_page=1" | json_field 'd[0]["id"] if d else ""' || true)
  [ -n "$pipeline_id" ] && break
  i=$((i + 1))
  sleep 5
done
[ -n "$pipeline_id" ] || die "pipeline GitLab introuvable pour le tag $TAG (vérifie qu'un runner est disponible)."
printf 'Pipeline: %s/-/pipelines/%s\n' "$WEB_URL" "$pipeline_id"

if [ "$WAIT_FOR_CI" -eq 1 ]; then
  log "Attente de la fin du pipeline"
  last=""
  while :; do
    jobs=$(gitlab_api "pipelines/$pipeline_id/jobs?per_page=50" \
      | json_field "\"  \".join(f\"{j['name']}={j['status']}\" for j in sorted(d, key=lambda j: j['name']))")
    if [ "$jobs" != "$last" ]; then
      printf '%s  %s\n' "$(date +%H:%M:%S)" "$jobs"
      last=$jobs
    fi
    status=$(gitlab_api "pipelines/$pipeline_id" | json_field 'd["status"]')
    case "$status" in
      success) break ;;
      failed | canceled | skipped) die "pipeline $status : $WEB_URL/-/pipelines/$pipeline_id" ;;
    esac
    sleep "$POLL_SECONDS"
  done
fi

if [ "$DOWNLOAD_ARTIFACTS" -eq 1 ]; then
  require_cmd unzip
  output_dir="$DIST_ROOT/$TAG"
  rm -rf "$output_dir"
  mkdir -p "$output_dir"

  log "Téléchargement des installateurs"
  gitlab_api "pipelines/$pipeline_id/jobs?per_page=50" \
    | json_field "\"\\n\".join(f\"{j['id']} {j['name']}\" for j in d if j['name'].startswith('build-') and j['status'] == 'success')" \
    | while read -r job_id job_name; do
      [ -n "$job_id" ] || continue
      archive="$output_dir/$job_name.zip"
      curl -fsS --retry 3 -L -H "@$HEADER_FILE" -o "$archive" "$API/jobs/$job_id/artifacts"
      unzip -q -j -o "$archive" -d "$output_dir/$job_name"
      rm -f "$archive"
    done

  log "Installateurs téléchargés"
  find "$output_dir" -type f | sort
fi

log "Terminé"
printf 'Tag: %s\n' "$TAG"
printf 'Pipeline: %s/-/pipelines/%s\n' "$WEB_URL" "${pipeline_id:-}"
