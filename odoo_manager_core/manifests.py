"""Manifestes des modules Odoo : lecture, graphe de dépendances et plan d'installation.

Fonctions pures : elles ne connaissent ni le workspace ni Docker. Le backend leur passe
les chemins ou les textes de manifestes qu'il a trouvés.
"""

import ast
import posixpath
import re
from pathlib import Path

# États pour lesquels Odoo considère une dépendance comme satisfaite.
INSTALLED_MODULE_STATES = frozenset(("installed", "to install", "to upgrade"))


def read_manifest_dict(path):
    # Odoo lit lui-même le manifeste avec ast.literal_eval : même règle ici.
    for filename in ("__manifest__.py", "__openerp__.py"):
        try:
            text = (Path(path) / filename).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        return parse_manifest_text(text)
    return {}


def parse_manifest_text(text):
    try:
        manifest = ast.literal_eval(text)
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        return {}
    return manifest if isinstance(manifest, dict) else {}


def manifest_graph_entry(manifest):
    depends = sorted({name for name in manifest.get("depends") or () if isinstance(name, str)})
    auto_install = manifest.get("auto_install", False)
    if isinstance(auto_install, (list, tuple, set)):
        # Odoo 16+ : seules ces dépendances déclenchent l'installation automatique.
        triggers = sorted({name for name in auto_install if isinstance(name, str)})
        auto_install = True
    else:
        triggers = depends
        auto_install = bool(auto_install)
    return {
        "title": str(manifest.get("name") or ""),
        "depends": depends,
        "auto_install": auto_install,
        "auto_install_triggers": triggers,
        "installable": bool(manifest.get("installable", True)),
        "application": bool(manifest.get("application", False)),
        # L'installation auto dépend alors du pays des sociétés : non prévisible ici.
        "country_restricted": bool(manifest.get("countries")),
    }


def module_graph_from_paths(paths):
    graph = {}
    for path in paths:
        name = posixpath.basename(str(path).replace("\\", "/"))
        if name not in graph:
            graph[name] = manifest_graph_entry(read_manifest_dict(path))
    return graph


# Marqueur textuel : un séparateur de contrôle comme \x1e est retiré par str.strip().
MANIFEST_RECORD_MARKER = "@@odoo-manager-manifest@@ "


def module_graph_from_records(output, name_pattern):
    """Graphe lu dans une sortie où chaque manifeste suit une ligne MANIFEST_RECORD_MARKER + nom du module.

    Un nom refusé par `name_pattern` est ignoré, comme un second manifeste du même module.
    """
    graph = {}
    for record in ("\n" + output).split("\n" + MANIFEST_RECORD_MARKER)[1:]:
        name, _, text = record.partition("\n")
        name = name.strip()
        if not name_pattern.fullmatch(name) or name in graph:
            continue
        graph[name] = manifest_graph_entry(parse_manifest_text(text))
    return graph


def module_install_plan(graph, states, requested):
    """Reproduit la résolution d'Odoo pour `-i` : dépendances récursives puis
    modules auto_install dont un déclencheur passe à l'état « to install »."""
    installed = {name for name, info in states.items() if info.get("state") in INSTALLED_MODULE_STATES}
    installed.add("base")
    requested = list(dict.fromkeys(requested))
    to_install = {}
    missing = {}
    uninstallable = {}
    auto_installed = set()

    def add(name, required_by):
        stack = [(name, required_by)]
        while stack:
            current, parent = stack.pop()
            if current in installed or current in to_install:
                continue
            entry = graph.get(current)
            if entry is None:
                missing.setdefault(current, parent)
                continue
            if not entry["installable"]:
                uninstallable.setdefault(current, parent)
                continue
            to_install[current] = parent
            stack.extend((dependency, current) for dependency in entry["depends"])

    for name in requested:
        add(name, "")

    candidates = sorted(
        name
        for name, entry in graph.items()
        if entry["auto_install"]
        and entry["installable"]
        and entry["auto_install_triggers"]
        and not entry["country_restricted"]
    )
    changed = True
    while changed:
        changed = False
        for name in candidates:
            if name in installed or name in to_install:
                continue
            triggers = graph[name]["auto_install_triggers"]
            satisfied = all(trigger in installed or trigger in to_install for trigger in triggers)
            if satisfied and any(trigger in to_install for trigger in triggers):
                auto_installed.add(name)
                add(name, "")
                changed = True

    requested_set = set(requested)
    new_modules = [name for name in to_install if name not in requested_set]

    def described(names):
        return [{"name": name, "title": graph.get(name, {}).get("title") or name} for name in sorted(names)]

    return {
        "requested": [name for name in requested if name in to_install],
        "already_installed": [name for name in requested if name in installed],
        "dependencies": described(name for name in new_modules if name not in auto_installed),
        "auto_installed": described(name for name in new_modules if name in auto_installed),
        "applications": described(name for name in new_modules if graph[name]["application"]),
        "missing": [{"name": name, "required_by": parent} for name, parent in sorted(missing.items())],
        "uninstallable": [{"name": name, "required_by": parent} for name, parent in sorted(uninstallable.items())],
        "total": len(to_install),
    }


MANIFEST_FILENAMES = ("__manifest__.py", "__openerp__.py")
MAX_MANIFEST_BYTES = 512 * 1024
ODOO_SERIES_VERSION_RE = re.compile(r"^(\d+\.\d+)\.\d+\.\d+\.\d+$")


def manifest_version_key(version):
    parts = re.findall(r"\d+", str(version or ""))
    return tuple(int(part) for part in parts) if parts else None


def read_repository_manifest(module_path):
    for filename in MANIFEST_FILENAMES:
        manifest = Path(module_path) / filename
        try:
            if manifest.is_symlink() or not manifest.is_file():
                continue
            if manifest.stat().st_size > MAX_MANIFEST_BYTES:
                return {}
            return parse_manifest_text(manifest.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            return {}
    return {}
