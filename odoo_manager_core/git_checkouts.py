"""Dépôts Git d'où viennent les modules d'un projet : racine, branche et adresse d'origine.

Deux sources :
- un clone Git : les fichiers de `.git` sont lus directement plutôt que par `git`, sans
  processus par dépôt ni Git à installer côté Windows quand il ne vit que dans WSL. Les cas
  courants suffisent : une branche, un commit détaché nommé par une étiquette, le dépôt `origin` ;
- un dépôt téléchargé depuis la plateforme SDK, sans `.git` : son fichier `info.sdk` donne
  l'adresse, la branche active et le commit.
"""

import itertools
import json
import os
import re
from pathlib import Path

SDK_INFO_FILE = "info.sdk"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
CONFIG_SECTION_RE = re.compile(r'^\s*\[\s*([^\]\s"]+)(?:\s+"([^"]*)")?\s*\]')
CONFIG_VALUE_RE = re.compile(r"^\s*([A-Za-z][\w-]*)\s*=\s*(.*?)\s*$")
# Étiquettes lues au plus, pour un commit détaché : au-delà, il est désigné par son commit.
MAX_LOOSE_TAGS = 500


def normalized(path):
    return os.path.normcase(os.path.normpath(os.fspath(path)))


class CheckoutFinder:
    """Dépôt (clone Git ou téléchargement SDK) qui contient un module, chaque dossier examiné une fois.

    Les dossiers de `boundaries` (dossier du projet, des projets) ne sont jamais retenus : le
    dépôt du modèle de projet ne contient pas les modules, que son .gitignore exclut.
    """

    def __init__(self, boundaries=(), levels=3):
        self.boundaries = {normalized(boundary) for boundary in boundaries}
        self.levels = levels
        self.checkouts = {}

    def is_checkout(self, directory):
        key = normalized(directory)
        if key not in self.checkouts:
            self.checkouts[key] = key not in self.boundaries and (
                os.path.lexists(os.path.join(key, ".git")) or os.path.isfile(os.path.join(key, SDK_INFO_FILE))
            )
        return self.checkouts[key]

    def root(self, module_dir, check_module=False):
        """Racine du dépôt du module, chaîne vide s'il n'est dans aucun.

        `check_module` : le dossier du module peut être lui-même un dépôt (module seul dans son
        dépôt, cloné directement dans addons-store). Ce test coûte un accès disque par module :
        inutile pour les modules rangés dans un dépôt ou dans le code d'Odoo.
        """
        module_dir = os.fspath(module_dir)
        if check_module and self.is_checkout(module_dir):
            return module_dir
        directory = module_dir
        for _ in range(self.levels):
            parent = os.path.dirname(directory)
            if parent == directory or normalized(parent) in self.boundaries:
                return ""
            if self.is_checkout(parent):
                return parent
            directory = parent
        return ""


def git_directory(root):
    """Dossier Git d'une copie de travail : `.git`, ou celui que désigne un fichier `.git`."""
    dot_git = Path(root) / ".git"
    if dot_git.is_dir():
        return dot_git
    try:
        text = dot_git.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    match = re.match(r"gitdir:\s*(.+)", text)
    if not match:
        return None
    target = Path(match.group(1).strip())
    return target if target.is_absolute() else Path(root) / target


def common_directory(git_dir):
    """Dossier partagé d'un worktree, qui porte la configuration et les références communes."""
    try:
        text = (git_dir / "commondir").read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return git_dir
    path = Path(text)
    return path if path.is_absolute() else git_dir / path


def packed_refs(common):
    """(commit, référence) de packed-refs ; une ligne `^commit` donne le commit d'une étiquette annotée."""
    try:
        lines = (common / "packed-refs").read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    refs = []
    for line in lines:
        if line.startswith("^") and refs:
            refs[-1] = (line[1:].strip(), refs[-1][1])
        elif line and not line.startswith("#"):
            sha, _, ref = line.partition(" ")
            refs.append((sha.strip(), ref.strip()))
    return refs


def resolve_ref(git_dir, common, ref):
    for directory in (git_dir, common):
        try:
            sha = (directory / ref).read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            continue
        if SHA_RE.match(sha):
            return sha
    return next((sha for sha, name in packed_refs(common) if name == ref), "")


def tag_for_commit(common, commit):
    """Étiquette posée sur `commit` ; les étiquettes annotées ne sont reconnues que dans packed-refs."""
    names = [name for sha, name in packed_refs(common) if sha == commit and name.startswith("refs/tags/")]
    if names:
        return sorted(names)[0].removeprefix("refs/tags/")
    tags = common / "refs" / "tags"
    try:
        candidates = list(itertools.islice(tags.rglob("*"), MAX_LOOSE_TAGS))
    except OSError:
        return ""
    for path in sorted(candidates):
        try:
            if path.is_file() and path.read_text(encoding="utf-8", errors="replace").strip() == commit:
                return path.relative_to(tags).as_posix()
        except OSError:
            continue
    return ""


def remote_url(common, preferred="origin"):
    """Adresse du dépôt distant `origin`, ou du premier distant déclaré."""
    try:
        lines = (common / "config").read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    urls = {}
    section = None
    for line in lines:
        header = CONFIG_SECTION_RE.match(line)
        if header:
            section = header.group(2) if header.group(1).lower() == "remote" else None
            continue
        value = CONFIG_VALUE_RE.match(line)
        if section is not None and value and value.group(1).lower() == "url":
            urls.setdefault(section, value.group(2).strip().strip('"'))
    return urls.get(preferred) or next(iter(urls.values()), "")


def without_credentials(url):
    """Adresse sans identifiants : un jeton glissé dans une URL https ne doit pas s'afficher."""
    return re.sub(r"^(https?://)[^/@]*@", r"\1", url or "")


def remote_label(url):
    """Adresse courte : gitlab.sudokeys.com/OCA/pos pour ssh://git@gitlab.sudokeys.com:10022/OCA/pos.git."""
    url = without_credentials(url).strip()
    if not url:
        return ""
    match = re.match(r"^[a-z][\w+.-]*://(?:[^@/]*@)?([^/:]+)(?::\d+)?/(.+)$", url, re.IGNORECASE)
    if not match:
        match = re.match(r"^(?:[^@/]+@)?([^:/]+):(.+)$", url)
    if not match:
        return url
    return f"{match.group(1)}/{match.group(2).rstrip('/').removesuffix('.git')}"


def read_sdk_info(root):
    """Dépôt téléchargé depuis la plateforme SDK : son info.sdk, None s'il est absent ou illisible."""
    try:
        info = json.loads((Path(root) / SDK_INFO_FILE).read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return None
    if not isinstance(info, dict):
        return None
    remotes = info.get("remotes") if isinstance(info.get("remotes"), dict) else {}
    url = str(remotes.get("origin") or next(iter(remotes.values()), "") or "")
    commit = str(info.get("commit") or "")
    return {
        "source": "sdk",
        "branch": str(info.get("active_branch") or ""),
        "tag": "",
        "commit": commit if SHA_RE.match(commit) else "",
        "remote": without_credentials(url),
        "remote_label": remote_label(url),
    }


def read_checkout(root):
    """Branche, étiquette, commit et adresse d'un dépôt ; None si ni .git ni info.sdk n'est lisible."""
    git_dir = git_directory(root)
    if git_dir is None:
        return read_sdk_info(root)
    try:
        head = (git_dir / "HEAD").read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return read_sdk_info(root)
    common = common_directory(git_dir)
    branch = tag = commit = ""
    if head.startswith("ref:"):
        ref = head[4:].strip()
        branch = ref.removeprefix("refs/heads/")
        commit = resolve_ref(git_dir, common, ref)
    elif SHA_RE.match(head):
        commit = head
        tag = tag_for_commit(common, head)
    url = remote_url(common)
    return {
        "source": "git",
        "branch": branch,
        "tag": tag,
        "commit": commit,
        "remote": without_credentials(url),
        "remote_label": remote_label(url),
    }
