"""Versions publiées de l'application, lues dans les tags de son dépôt GitLab.

`scripts/publish_gitlab_release.sh` crée un tag `app-v<version>-build<N>` sur GitLab pour chaque
Release : la liste des tags est donc celle des versions téléchargeables. Elle se lit avec la clé
SSH déjà déposée sur GitLab pour cloner les projets, sans jeton d'API.
"""

import re

RELEASES_REPOSITORY = "ssh://git@gitlab.sudokeys.com:10022/cdp/sdk-local-manager.git"
RELEASES_PAGE = "https://gitlab.sudokeys.com/cdp/sdk-local-manager/-/releases"
RELEASE_TAG_RE = re.compile(r"refs/tags/(?P<tag>app-v(?P<version>\d+\.\d+\.\d+)(?:-build(?P<build>\d+))?)$")


def version_key(version):
    return tuple(int(part) for part in version.split("."))


def latest_release(ls_remote_output):
    """(tag, version) de la Release la plus récente, ou None sans tag reconnu."""
    releases = []
    for line in ls_remote_output.splitlines():
        match = RELEASE_TAG_RE.search(line.strip())
        if match:
            key = (*version_key(match.group("version")), int(match.group("build") or 0))
            releases.append((key, match.group("tag"), match.group("version")))
    if not releases:
        return None
    _key, tag, version = max(releases)
    return tag, version


def release_update(current_version, ls_remote_output):
    """Ce que l'interface affiche : la dernière version publiée et si elle est plus récente."""
    latest = latest_release(ls_remote_output)
    if latest is None:
        return {"current": current_version, "latest": "", "tag": "", "update_available": False, "url": RELEASES_PAGE}
    tag, version = latest
    return {
        "current": current_version,
        "latest": version,
        # L'application de bureau télécharge les installateurs publiés sous ce tag.
        "tag": tag,
        "update_available": version_key(version) > version_key(current_version),
        "url": f"{RELEASES_PAGE}/{tag}",
    }


def release_check_error(code, output):
    """Pourquoi la liste des versions n'a pas pu être lue, dit simplement et avec la suite à donner."""
    text = str(output or "").lower()
    unreachable = (
        "could not resolve hostname",
        "connection timed out",
        "operation timed out",
        "connection refused",
        "network is unreachable",
        "no route to host",
    )
    if code == 124 or any(marker in text for marker in unreachable):
        return "GitLab est injoignable : vérifie la connexion à Internet ou au réseau de Sudokeys, puis réessaie."
    if "host key verification failed" in text or "remote host identification has changed" in text:
        return (
            "Le serveur GitLab ne présente pas l'identité attendue : vérification arrêtée par sécurité. "
            "Préviens l'équipe technique."
        )
    if "permission denied" in text or "publickey" in text:
        return "GitLab refuse la clé SSH de ce poste : ajoute-la dans ton compte GitLab, puis réessaie."
    return "Vérification impossible pour le moment. Réessaie plus tard."
