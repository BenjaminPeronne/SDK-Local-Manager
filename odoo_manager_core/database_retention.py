"""Durée de conservation des bases : les données des clients ne restent pas sur le poste.

Une base qui arrive sur le poste (restaurée, dupliquée, ou découverte sans que le gestionnaire
l'ait créée) est supprimée 30 jours plus tard, filestore compris. Seule une base vide créée par
le gestionnaire est conservée : elle ne contient aucune donnée client. L'utilisateur peut
repousser l'échéance de 30 jours, autant de fois qu'il le faut ; il ne peut pas couper la règle.

Une base est reconnue par son nom et par son identifiant PostgreSQL (oid) : une base supprimée
puis recréée sous le même nom est une nouvelle base, avec sa propre échéance.

Le registre vit dans le dossier de configuration du poste, par dossier des projets puis par
projet. Il est gardé en mémoire et réécrit en entier à chaque changement.
"""

import json
import threading
import time
from datetime import datetime

RETENTION_DAYS = 30
DAY_SECONDS = 24 * 60 * 60
RETENTION_SECONDS = RETENTION_DAYS * DAY_SECONDS
# Un projet arrêté n'est relu qu'à cet intervalle : une base ajoutée sans que le gestionnaire
# la voie (Docker piloté à la main, gestionnaire fermé) est découverte au plus tard à ce moment.
INVENTORY_MAX_AGE_SECONDS = RETENTION_SECONDS
# Base système de PostgreSQL : jamais une base Odoo, jamais supprimée.
SYSTEM_DATABASES = frozenset({"postgres"})

# Origines enregistrées : `created` (base vide créée par le gestionnaire, conservée), `restored`,
# `duplicated`, et `detected` (base trouvée dans PostgreSQL sans que le gestionnaire l'ait créée).
ORIGINS = frozenset({"created", "restored", "duplicated", "detected"})


class RetentionStore:
    def __init__(self, path, clock=time.time):
        self.path = path
        self.clock = clock
        self.lock = threading.Lock()
        self._payload = None

    # --- Lecture et écriture du registre --------------------------------------------------

    def _load(self):
        """Registre en mémoire ; relu une seule fois. Appelé sous le verrou."""
        if self._payload is not None:
            return self._payload
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            payload = {}
        workspaces = payload.get("workspaces") if isinstance(payload, dict) else None
        self._payload = {"version": 1, "workspaces": workspaces if isinstance(workspaces, dict) else {}}
        return self._payload

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self._payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.path)

    def _project(self, workspace, project, create=False):
        workspaces = self._load()["workspaces"]
        projects = workspaces.get(workspace)
        if not isinstance(projects, dict):
            if not create:
                return None
            projects = workspaces[workspace] = {}
        state = projects.get(project)
        if not isinstance(state, dict) or not isinstance(state.get("databases"), dict):
            if not create:
                return None
            state = projects[project] = {"inventoried_at": None, "databases": {}}
        return state

    # --- Consultation ---------------------------------------------------------------------

    def project_state(self, workspace, project):
        """Copie de l'état d'un projet : {"inventoried_at": ..., "databases": {base: fiche}}."""
        with self.lock:
            state = self._project(workspace, project)
            if state is None:
                return {"inventoried_at": None, "databases": {}}
            return {
                "inventoried_at": state.get("inventoried_at"),
                "databases": {name: dict(record) for name, record in state["databases"].items()},
            }

    # --- Changements ----------------------------------------------------------------------

    def record_arrival(self, workspace, project, db_name, oid, origin, source=None):
        """Note l'arrivée d'une base. Une copie garde l'échéance de sa base d'origine."""
        if origin not in ORIGINS:
            raise ValueError(f"Origine de base inconnue : {origin}")
        now = self.clock()
        with self.lock:
            state = self._project(workspace, project, create=True)
            expires_at = None if origin == "created" else now + RETENTION_SECONDS
            if origin == "duplicated" and source:
                original = state["databases"].get(source)
                if original is not None:
                    expires_at = original.get("expires_at")
            state["databases"][db_name] = {
                "oid": int(oid),
                "origin": origin,
                "arrived_at": now,
                "expires_at": expires_at,
            }
            self._save()
            return dict(state["databases"][db_name])

    def reconcile(self, workspace, project, live):
        """Aligne le registre sur les bases présentes ({nom: oid}) et renvoie l'état du projet.

        Une base inconnue (ou recréée sous le même nom) commence ses 30 jours maintenant ; la
        fiche d'une base disparue est retirée.
        """
        now = self.clock()
        live = {name: int(oid) for name, oid in live.items() if name not in SYSTEM_DATABASES}
        with self.lock:
            state = self._project(workspace, project, create=True)
            databases = state["databases"]
            changed = False
            for name in list(databases):
                if live.get(name) != databases[name].get("oid"):
                    del databases[name]
                    changed = True
            for name, oid in live.items():
                if name not in databases:
                    databases[name] = {
                        "oid": oid,
                        "origin": "detected",
                        "arrived_at": now,
                        "expires_at": now + RETENTION_SECONDS,
                    }
                    changed = True
            # Relevé daté à la journée près : le registre n'est pas réécrit à chaque passage.
            previous = state.get("inventoried_at")
            if changed or not isinstance(previous, (int, float)) or now - previous >= DAY_SECONDS:
                state["inventoried_at"] = now
                changed = True
            if changed:
                self._save()
        return self.project_state(workspace, project)

    def extend(self, workspace, project, db_name):
        """Repousse l'échéance de 30 jours, à partir de l'échéance actuelle ou de maintenant."""
        now = self.clock()
        with self.lock:
            state = self._project(workspace, project)
            record = state["databases"].get(db_name) if state else None
            if record is None:
                raise ValueError(f"Base inconnue : {db_name}")
            if record.get("expires_at") is None:
                raise ValueError(f"La base {db_name} n'a pas d'échéance : elle est conservée.")
            record["expires_at"] = max(record["expires_at"], now) + RETENTION_SECONDS
            self._save()
            return record["expires_at"]

    def forget(self, workspace, project, db_name):
        with self.lock:
            state = self._project(workspace, project)
            if state is not None and state["databases"].pop(db_name, None) is not None:
                self._save()

    def prune_projects(self, workspace, keep):
        """Oublie les projets qui n'existent plus, ni dans le dossier des projets ni dans la corbeille."""
        with self.lock:
            projects = self._load()["workspaces"].get(workspace)
            if not isinstance(projects, dict):
                return
            gone = [project for project in projects if project not in keep]
            for project in gone:
                del projects[project]
            if gone:
                self._save()


# --- Décisions ----------------------------------------------------------------------------


def expired_databases(state, now):
    """Bases dont l'échéance est passée, par ordre alphabétique."""
    return sorted(
        name
        for name, record in state["databases"].items()
        if isinstance(record.get("expires_at"), (int, float)) and record["expires_at"] <= now
    )


def needs_inventory(state, now):
    """Projet jamais relu, ou relu il y a trop longtemps pour savoir quelles bases il contient."""
    inventoried_at = state.get("inventoried_at")
    return not isinstance(inventoried_at, (int, float)) or now - inventoried_at >= INVENTORY_MAX_AGE_SECONDS


def retention_summary(state):
    """Ce que l'interface affiche : échéance et origine de chaque base connue."""
    return {
        name: {"expires_at": record.get("expires_at"), "origin": record.get("origin", "detected")}
        for name, record in state["databases"].items()
    }


def trash_deleted_timestamp(entry):
    """Heure de suppression d'une entrée de la corbeille, lue dans son nom (heure locale)."""
    try:
        return datetime.strptime(entry["deleted_at"], "%Y-%m-%d %H:%M").timestamp()
    except (KeyError, TypeError, ValueError):
        return None


def expired_trash_entries(entries, now):
    """Entrées de la corbeille supprimées il y a plus de 30 jours : elles contiennent encore des bases."""
    expired = []
    for entry in entries:
        deleted_at = trash_deleted_timestamp(entry)
        if deleted_at is not None and now - deleted_at >= RETENTION_SECONDS:
            expired.append(entry)
    return expired
