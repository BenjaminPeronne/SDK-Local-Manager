"""Dépendances manquantes d'une base : ce qu'Odoo ne pourra pas charger, et pourquoi.

Un module installé dont le code est absent n'est pas le seul dégât : Odoo écarte aussi, sans
erreur visible, chaque module présent qui en dépend, même indirectement (« Unmet dependencies »
dans son journal). Les vues de ces modules restent pourtant en base et font échouer l'interface
web sur des champs « undefined ».
"""

from .manifests import INSTALLED_MODULE_STATES


def _unavailable(name, graph):
    entry = graph.get(name)
    return entry is None or not entry.get("installable", True)


def dependency_report(graph, states, excluded=frozenset(), database_only=frozenset()):
    """Rapport d'une base à partir du graphe des manifestes du projet et des états Odoo.

    `graph` : {module: {"depends": [...], "installable": bool}} lu dans le code du projet.
    `states` : {module: {"state": ...}} lu dans ir_module_module.
    `excluded` : modules exclus localement par l'utilisateur, signalés comme tels.
    """
    active = {name for name, state in states.items() if state.get("state") in INSTALLED_MODULE_STATES}
    active -= set(database_only)
    missing = {name for name in active if _unavailable(name, graph)}

    # Point fixe : un module est écarté dès qu'une de ses dépendances manque ou est elle-même écartée.
    not_loaded = {}
    changed = True
    while changed:
        changed = False
        for name in sorted(active - missing - set(not_loaded)):
            blocking = sorted(
                dependency
                for dependency in graph[name].get("depends", ())
                if dependency not in database_only
                and (dependency in missing or dependency in not_loaded or _unavailable(dependency, graph))
            )
            if blocking:
                not_loaded[name] = blocking
                changed = True

    root_cache = {}

    def root_causes(name, trail=()):
        if name in root_cache:
            return root_cache[name]
        if name not in not_loaded:
            return {name}
        causes = set()
        for dependency in not_loaded[name]:
            if dependency not in trail:
                causes |= root_causes(dependency, (*trail, name))
        root_cache[name] = causes
        return causes

    # Dépendances absentes du code et de la base : Odoo les réclame aussi.
    unknown = {
        dependency for blocking in not_loaded.values() for dependency in blocking if dependency not in not_loaded
    } - missing

    required_by = {}
    for name in active - missing:
        for dependency in graph.get(name, {}).get("depends", ()):
            if dependency in missing or dependency in unknown:
                required_by.setdefault(dependency, set()).add(name)

    missing_rows = [
        {
            "name": name,
            "state": states.get(name, {}).get("state", "absent de la base"),
            "reason": "non installable" if name in graph else "code absent",
            "required_by": sorted(required_by.get(name, ())),
            "excluded": name in excluded,
        }
        for name in sorted(missing | unknown)
    ]
    not_loaded_rows = [
        {
            "name": name,
            "blocked_by": not_loaded[name],
            "root_causes": sorted(root_causes(name)),
        }
        for name in sorted(not_loaded)
    ]
    return {
        "ok": not missing_rows and not not_loaded_rows,
        "missing": missing_rows,
        "not_loaded": not_loaded_rows,
    }
