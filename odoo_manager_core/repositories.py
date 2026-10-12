"""Dépôts Git de modules : repérage des modules dans l'arborescence et messages d'échec du clone."""

import posixpath
import re

from odoo_manager_core.git_checkouts import remote_label
from odoo_manager_core.manifests import MANIFEST_FILENAMES

REPOSITORY_SKIPPED_DIRS = frozenset({".git", "__pycache__", "node_modules"})


def repository_modules_from_tree(tree_output, repository_name):
    """Modules d'un `git ls-tree -r` selon la règle de find_module_candidates.

    Un manifeste à la racine fait du dépôt un module unique ; sinon chaque dossier portant
    un manifeste est un module, sans descendre dans ses sous-dossiers.
    """
    manifest_dirs = set()
    has_symlinks = False
    for line in str(tree_output or "").splitlines():
        meta, _, path = line.partition("\t")
        if not path:
            continue
        if meta.split(" ", 1)[0] == "120000":
            has_symlinks = True
        if posixpath.basename(path) in MANIFEST_FILENAMES:
            manifest_dirs.add(posixpath.dirname(path))
    modules = {}
    for directory in sorted(manifest_dirs, key=lambda item: (item.count("/") if item else -1, item)):
        parts = directory.split("/") if directory else []
        if any(part in REPOSITORY_SKIPPED_DIRS for part in parts):
            continue
        if "" in modules:
            break
        if any("/".join(parts[:index]) in modules for index in range(1, len(parts))):
            continue
        modules[directory] = parts[-1] if parts else repository_name
    return modules, has_symlinks


REPOSITORY_GIT_OPTIONS = (
    "-c",
    "core.sshCommand=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
    "-c",
    "protocol.allow=never",
    "-c",
    "protocol.ssh.allow=always",
)


REPOSITORY_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")

# Branches lues au plus dans un dépôt : au-delà, la recherche de la liste suffit à s'y retrouver.
MAX_REMOTE_BRANCHES = 2000
REMOTE_HEAD_RE = re.compile(r"^ref:\s*refs/heads/(\S+)\s+HEAD$")
REMOTE_BRANCH_RE = re.compile(r"^[0-9a-f]{40}\s+refs/heads/(\S+)$")


def natural_key(name):
    """Tri naturel : 8.0 avant 10.0. Les morceaux alternent texte et nombre, donc restent comparables."""
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", name)]


def remote_branches(ls_remote_output):
    """Branches d'un `git ls-remote --symref <dépôt> HEAD refs/heads/*`, branche par défaut en tête.

    Les autres lignes (avertissements SSH mêlés à la sortie) sont ignorées.
    """
    default = ""
    names = set()
    for line in str(ls_remote_output or "").splitlines():
        line = line.strip()
        head = REMOTE_HEAD_RE.match(line)
        if head:
            default = head.group(1)
            continue
        branch = REMOTE_BRANCH_RE.match(line)
        if branch:
            names.add(branch.group(1))
    ordered = sorted(names, key=lambda name: (name != default, natural_key(name)))[:MAX_REMOTE_BRANCHES]
    return [{"name": name, "default": name == default} for name in ordered]


def sparse_checkout_pattern(path):
    """Motif sparse-checkout ne désignant que ce chemin exact, caractères spéciaux échappés."""
    escaped = "".join("\\" + char if char in "*?[\\" else char for char in path)
    return "/" + escaped + "\n"


def repository_tree_modules(tree_output, repository_name):
    """Liste (chemin, nom, manifeste) et les liens symboliques d'un `git ls-tree -r`."""
    found, has_symlinks = repository_modules_from_tree(tree_output, repository_name)
    manifest_files = {}
    symlinks = []
    for line in str(tree_output or "").splitlines():
        meta, _, path = line.partition("\t")
        if not path:
            continue
        if meta.split(" ", 1)[0] == "120000":
            symlinks.append(path)
        directory, filename = posixpath.dirname(path), posixpath.basename(path)
        if filename in MANIFEST_FILENAMES and directory in found:
            manifest_files.setdefault(directory, filename)
    return [(path, name, manifest_files.get(path, MANIFEST_FILENAMES[0])) for path, name in found.items()], symlinks


class RepositoryBranchMissing(RuntimeError):
    """La branche ou le tag demandé n'existe pas dans le dépôt."""


# Branches lues au plus par dépôt : chacune ne sert qu'aux modules absents des précédentes.
MAX_SEARCH_BRANCHES = 3


def repository_search_sources(entries, project, odoo_version):
    """Dépôts où chercher les modules manquants d'un projet, avec les branches à lire dans l'ordre.

    `entries` : (projet, version Odoo du projet, URL, branche) de chaque dépôt rangé ou importé dans
    les projets. Viennent la branche que le projet utilise déjà, puis celle qui porte le nom de la
    version (branche stable des dépôts OCA), puis celles des autres projets de la même version, les
    plus utilisées d'abord : une branche de travail ne fournit ainsi que ce que la branche stable n'a
    pas. Les dépôts du projet passent en tête.
    """
    sources = {}
    for entry_project, entry_version, url, branch in entries:
        label = remote_label(url)
        if not label:
            continue
        source = sources.setdefault(
            label.casefold(), {"url": url, "label": label, "own": "", "same": {}, "mine": False}
        )
        if entry_project == project:
            source["mine"] = True
            source["own"] = source["own"] or branch
        if branch and odoo_version and entry_version == odoo_version:
            source["same"][branch] = source["same"].get(branch, 0) + 1
    result = []
    for source in sources.values():
        others = sorted(source["same"], key=lambda name: (-source["same"][name], natural_key(name)))
        branches = list(dict.fromkeys(name for name in (source["own"], odoo_version, *others) if name))
        if branches:
            result.append(
                {
                    "url": source["url"],
                    "label": source["label"],
                    "branches": branches[:MAX_SEARCH_BRANCHES],
                    "in_project": source["mine"],
                }
            )
    return sorted(result, key=lambda source: (not source["in_project"], source["label"].casefold()))


def repository_clone_error(stderr):
    details = str(stderr or "").casefold()
    if any(
        marker in details for marker in ("permission denied (publickey)", "no such identity", "sign_and_send_pubkey")
    ):
        return RuntimeError(
            "GitLab refuse la clé SSH de cet ordinateur. Ouvre l’assistant Clé SSH du manager, "
            "puis vérifie que sa clé publique est autorisée dans GitLab."
        )
    if "host key verification failed" in details:
        return RuntimeError("L’identité du serveur GitLab n’a pas pu être vérifiée par SSH.")
    if any(
        marker in details
        for marker in (
            "remote branch",
            "couldn't find remote ref",
            "could not find remote branch",
            "not found in upstream origin",
        )
    ):
        return RepositoryBranchMissing("La branche ou le tag demandé est introuvable dans ce dépôt.")
    if any(
        marker in details
        for marker in ("could not resolve hostname", "failed to connect", "connection timed out", "connection refused")
    ):
        return RuntimeError("GitLab est inaccessible depuis cet ordinateur. Vérifie le réseau et le DNS.")
    return RuntimeError(
        "Récupération Git impossible. Vérifie l’URL SSH, la branche et l’autorisation de la clé dans GitLab."
    )
