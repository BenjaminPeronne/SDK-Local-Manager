"""File des actions du gestionnaire : création, planification, arrêt, historique et signaux.

Une action (Job) exécute une fonction dans son propre fil. Deux actions qui touchent la même
ressource (un projet, Git, Traefik) ne tournent jamais ensemble ; les autres attendent leur tour
dans l'ordre d'arrivée, dans la limite de MAX_RUNNING_JOBS.

Le backend branche ce qui lui est propre avec configure() : politiques d'arrêt par action,
journal d'erreurs et rafraîchissements à la fin d'une action.
"""

import json
import os
import threading
import time
import traceback

from odoo_manager_core import jobs as job_control
from odoo_manager_core.command_output import parse_output_progress
from odoo_manager_core.events import publish_event
from odoo_manager_core.project_service import OdooError

MAX_RETAINED_JOBS = 60
MAX_RUNNING_JOBS = 4
JOB_LINES_LIMIT = 700
JOB_OUTPUT_LIMIT = 120_000
JOBS = {}
JOBS_LOCK = threading.Lock()
NEXT_JOB_ID = 1
# Historique des actions, réécrit à chaque démarrage ou fin d'action. None tant que main() ne l'a pas
# activé : les tests qui importent le module n'écrivent rien dans le dossier du poste.
JOB_HISTORY_PATH = None
JOB_HISTORY_LOCK = threading.Lock()
JOB_HISTORY_OUTPUT_LIMIT = 40_000
JOB_INTERRUPTED_MESSAGE = "Action interrompue : le gestionnaire s'est arrêté pendant son exécution."
# Une action bavarde écrit des centaines de lignes par seconde : l'interface n'est prévenue
# qu'une fois par intervalle, puis relit la suite de la sortie.
JOBS_CHANGED = threading.Event()
JOBS_EVENT_MIN_INTERVAL_SECONDS = 0.5
JOB_ACTIVE_STATUSES = frozenset({"running", "cancelling"})
JOB_UNFINISHED_STATUSES = frozenset({"queued", "running", "cancelling"})
DEFAULT_JOB_CANCEL_POLICY = (
    True,
    "L'action est interrompue ; ce qu'elle a déjà modifié n'est pas annulé automatiquement.",
)


# (arrêt possible, ce que fait l'arrêt ou pourquoi il est impossible), par nom de fonction d'action.
CANCEL_POLICIES = {}
_HOOKS = {
    # Journal des erreurs du gestionnaire : (source, erreur, details=…, project=…).
    "record_error": lambda *_args, **_kwargs: None,
    # Appelé à la fin de chaque action, quand l'état des projets a pu changer.
    "on_finished": lambda: None,
}


def configure(*, cancel_policies=None, record_error=None, on_finished=None):
    """Branche ce qui appartient au backend ; les tests peuvent utiliser la file sans rien brancher."""
    if cancel_policies is not None:
        CANCEL_POLICIES.clear()
        CANCEL_POLICIES.update(cancel_policies)
    if record_error is not None:
        _HOOKS["record_error"] = record_error
    if on_finished is not None:
        _HOOKS["on_finished"] = on_finished


def jobs_conflict(first, second):
    """Deux actions qui ne doivent pas tourner en même temps : même ressource, ou action sur tous les projets."""
    if first.resources & second.resources:
        return True
    for everything, other in ((first, second), (second, first)):
        # `*` couvre tous les projets, pas Git ni Traefik.
        if "*" in everything.resources and any(item == "*" or item.startswith("project:") for item in other.resources):
            return True
    return False


def job_waiting_reason(job):
    """Pourquoi une action attend ; appelé sous JOBS_LOCK."""
    for other in JOBS.values():
        if other.id >= job.id:
            break
        if other.status in JOB_UNFINISHED_STATUSES and jobs_conflict(job, other):
            return f"Après « {other.title} »"
    return f"Limite de {MAX_RUNNING_JOBS} actions simultanées atteinte"


def schedule_jobs():
    """Démarre, dans l'ordre d'arrivée, les actions en attente qui ne croisent aucune action active."""
    to_start = []
    with JOBS_LOCK:
        active = [job for job in JOBS.values() if job.status in JOB_ACTIVE_STATUSES]
        waiting = []
        for job in JOBS.values():
            if job.status != "queued":
                continue
            # Une action arrivée plus tôt et encore bloquée garde la priorité sur son projet.
            if len(active) >= MAX_RUNNING_JOBS or any(jobs_conflict(job, other) for other in (*active, *waiting)):
                waiting.append(job)
                continue
            job.status = "running"
            job.started_at = time.strftime("%Y-%m-%d %H:%M:%S")
            job.thread = threading.Thread(target=job.run, daemon=True)
            active.append(job)
            to_start.append(job)
    for job in to_start:
        job.thread.start()
    if to_start:
        notify_jobs_changed()
        persist_job_history()


def cancel_job(job_id):
    """Arrête une action en cours ou la retire de la file d'attente."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise ValueError("Action introuvable.")
        status = job.status
        if status in {"done", "error", "cancelled"}:
            raise ValueError("Cette action est déjà terminée.")
        if status == "running" and not job.cancellable:
            raise ValueError(f"« {job.title} » ne peut pas être arrêtée : {job.cancel_hint}")
        if status == "queued":
            job.status = "cancelled"
            job.finished_at = time.strftime("%Y-%m-%d %H:%M:%S")
            job.error_message = "Retirée de la file d'attente avant son démarrage."
            job.target = None
            job.args = ()
    if status == "queued":
        job.add(job.error_message)
        job.publish_completion()
        persist_job_history()
        schedule_jobs()
        return job
    if status == "cancelling":
        return job

    outcome = job.control.request_cancel()
    if outcome == "refused":
        raise ValueError(
            f"« {job.title} » ne peut plus être arrêtée : étape irréversible en cours ({job.control.irreversible_step})."
        )
    with JOBS_LOCK:
        if job.status == "running":
            job.status = "cancelling"
    notify_jobs_changed()
    if outcome == "deferred":
        job.add(f"Arrêt demandé : il sera effectif à la fin de l'étape en cours ({job.control.protected_step}).")
    elif outcome == "accepted":
        job.add("Arrêt demandé : interruption de l'action...")
    return job


def job_failure_message(failure):
    """Message d'échec d'une tâche, avec l'origine : Odoo ou le gestionnaire."""
    message = str(failure).strip() or "Une erreur inattendue est survenue."
    if isinstance(failure, OdooError):
        return f"Erreur d'Odoo (code des modules ou données de la base, pas le gestionnaire) : {message}"
    return f"Erreur du gestionnaire : {message}"


class Job:
    def __init__(self, title, target, args=(), project=None, resources=None):
        global NEXT_JOB_ID
        self.title = title
        self.project = project
        self.status = "queued"
        self.started_at = time.strftime("%Y-%m-%d %H:%M:%S")
        self.finished_at = None
        self.error_message = ""
        self.lines = []
        self.output = ""
        # Nombre cumulé de caractères écrits : permet à l'interface de ne demander que la suite.
        self.output_total = 0
        self.result = {}
        self.progress = None
        self.target = target
        self.args = args
        self.thread = None
        self.control = job_control.JobControl()
        self.cancellable, self.cancel_hint = CANCEL_POLICIES.get(
            getattr(target, "__name__", ""), DEFAULT_JOB_CANCEL_POLICY
        )
        if resources is None:
            resources = {f"project:{project}"} if project else ()
        self.resources = frozenset(resources)
        with JOBS_LOCK:
            finished_ids = [job_id for job_id, job in JOBS.items() if job.status not in JOB_UNFINISHED_STATUSES]
            excess = max(0, len(JOBS) - MAX_RETAINED_JOBS + 1)
            for job_id in finished_ids[:excess]:
                JOBS.pop(job_id, None)
            self.id = NEXT_JOB_ID
            NEXT_JOB_ID += 1
            JOBS[self.id] = self
        notify_jobs_changed()
        schedule_jobs()

    @classmethod
    def from_history(cls, record):
        """Action terminée relue depuis l'historique ; une action alors en cours est marquée interrompue."""
        job = cls.__new__(cls)
        job.id = int(record["id"])
        job.title = str(record.get("title") or "Action")
        job.project = record.get("project") or None
        job.status = str(record.get("status") or "error")
        job.started_at = str(record.get("started_at") or "")
        job.finished_at = record.get("finished_at") or None
        job.error_message = str(record.get("error_message") or "")
        job.output = str(record.get("output") or "")
        job.output_total = len(job.output)
        job.lines = job.output.splitlines()[-JOB_LINES_LIMIT:]
        job.result = record.get("result") if isinstance(record.get("result"), dict) else {}
        job.progress = None
        job.target = None
        job.args = ()
        job.thread = None
        job.control = job_control.JobControl()
        job.cancellable, job.cancel_hint = False, ""
        job.resources = frozenset()
        if job.status in JOB_UNFINISHED_STATUSES:
            job.status = "error"
            job.finished_at = job.finished_at or job.started_at
            job.error_message = JOB_INTERRUPTED_MESSAGE
            job.lines.append(JOB_INTERRUPTED_MESSAGE)
            job._append_output(JOB_INTERRUPTED_MESSAGE + "\n")
        return job

    def history_record(self):
        """Ce que l'historique garde de l'action ; appelé sous JOBS_LOCK."""
        return {
            "id": self.id,
            "title": self.title,
            "project": self.project,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error_message": self.error_message,
            "result": dict(self.result),
            "output": self.output[-JOB_HISTORY_OUTPUT_LIMIT:],
        }

    def add(self, line):
        text = line.rstrip("\n")
        progress = parse_output_progress(text)
        if progress is not None:
            self.set_progress(progress["label"], progress["current"], progress["total"])
        # Seules les lignes réécrites en place par la commande sont retenues hors de
        # l'historique ; tout ce que le gestionnaire écrit lui-même y reste.
        if progress is None or not progress["transient"]:
            with JOBS_LOCK:
                self.lines.append(text)
                self._append_output(text + "\n")
        notify_jobs_changed()
        # Chaque ligne écrite par l'action est un point d'arrêt : les longues sorties Odoo s'interrompent vite.
        if job_control.current_control() is self.control:
            self.control.checkpoint()

    def _trim_lines(self):
        # Troncature amortie : recopier 700 lignes et 120 Ko à chaque ligne coûtait
        # cher pendant les longues sorties Odoo, verrou global tenu.
        if len(self.lines) > JOB_LINES_LIMIT * 2:
            del self.lines[:-JOB_LINES_LIMIT]

    def _append_output(self, text):
        self.output += text
        self.output_total += len(text)
        if len(self.output) > JOB_OUTPUT_LIMIT * 2:
            self.output = self.output[-JOB_OUTPUT_LIMIT:]
        self._trim_lines()

    def set_progress(self, label, current=None, total=None):
        with JOBS_LOCK:
            self.progress = {
                "label": str(label),
                "current": current,
                "total": total,
            }
        notify_jobs_changed()

    def run(self):
        failure = None
        failure_trace = ""
        try:
            with job_control.bind_control(self.control):
                try:
                    self.target(self, *self.args)
                except BaseException as exc:
                    failure, failure_trace = exc, traceback.format_exc()
                cancelled = self.control.cancel_requested and (failure is not None or self.control.cleaning_up)
                if cancelled:
                    self.finish_cancelled(failure)
            if not cancelled and failure is None:
                with JOBS_LOCK:
                    if self.status in JOB_ACTIVE_STATUSES:
                        self.status = "done"
                if self.control.cancel_requested:
                    self.add("Arrêt demandé après la fin de l'action : rien n'a été annulé.")
            elif not cancelled:
                self.error_message = job_failure_message(failure)
                self.add(f"Erreur: {self.error_message}")
                with JOBS_LOCK:
                    self.status = "error"
                _HOOKS["record_error"](
                    f"Job #{self.id} · {self.title}",
                    failure,
                    details=failure_trace,
                    project=self.project or "",
                )
        finally:
            dependents = []
            with JOBS_LOCK:
                self.finished_at = time.strftime("%Y-%m-%d %H:%M:%S")
                self.args = ()
                self.target = None
                self.thread = None
                if self.status in {"error", "cancelled"}:
                    outcome = "a été arrêtée" if self.status == "cancelled" else "a échoué"
                    for other in JOBS.values():
                        if other.status == "queued" and jobs_conflict(self, other):
                            other.status = "cancelled"
                            other.finished_at = self.finished_at
                            other.error_message = f"Annulée : l'action précédente « {self.title} » {outcome}."
                            other.target = None
                            other.args = ()
                            dependents.append(other)
            for other in dependents:
                other.add(other.error_message)
                other.publish_completion()
            _HOOKS["on_finished"]()
            self.publish_completion()
            notify_jobs_changed()
            persist_job_history()
            schedule_jobs()

    def finish_cancelled(self, failure):
        self.control.begin_cleanup()
        if failure is not None and not isinstance(failure, job_control.JobCancelled):
            self.add(f"Interruption : {failure}")
        failures = self.control.run_reverts(self.add)
        message = "Action arrêtée par l'utilisateur."
        if failures:
            message += " Retour arrière incomplet : " + " ; ".join(failures)
            _HOOKS["record_error"](f"Job #{self.id} · {self.title}", message, project=self.project or "")
        self.error_message = message
        self.add(message)
        with JOBS_LOCK:
            self.status = "cancelled"

    def publish_completion(self):
        publish_event(
            "job_completed",
            {
                "id": self.id,
                "status": self.status,
                "project": self.project,
                "finished_at": self.finished_at,
                "result": self.result,
            },
        )


def job_output_payload(job, compact, detail_job_id, output_from):
    if compact and job.id != detail_job_id:
        return {"lines": [], "output": ""}
    output = job.output[-JOB_OUTPUT_LIMIT:]
    window_start = job.output_total - len(output)
    if compact and output_from and window_start <= output_from <= job.output_total:
        # Suite seulement : l'interface possède déjà les caractères précédents.
        return {
            "lines": [],
            "output": output[len(output) - (job.output_total - output_from) :],
            "output_from": output_from,
        }
    payload = {"lines": job.lines[-JOB_LINES_LIMIT:], "output": output}
    if compact:
        payload["output_from"] = 0
    return payload


def jobs_snapshot(detail_job_id=None, compact=False, output_from=None):
    with JOBS_LOCK:
        values = list(JOBS.values())[-30:]
        if compact and detail_job_id is None and values:
            detail_job_id = values[-1].id
        return [
            {
                "id": job.id,
                "title": job.title,
                "project": job.project,
                "status": job.status,
                "started_at": job.started_at,
                "finished_at": job.finished_at,
                "error_message": job.error_message,
                "last_line": job.lines[-1] if job.lines else "",
                "output_total": job.output_total,
                **job_output_payload(job, compact, detail_job_id, output_from),
                "result": dict(job.result),
                "progress": dict(job.progress) if job.progress else None,
                **job_cancel_payload(job),
            }
            for job in reversed(values)
        ]


def unfinished_job(target, project):
    """Job déjà en file ou en cours pour cette action et ce projet, s'il existe."""
    with JOBS_LOCK:
        for job in JOBS.values():
            if job.target is target and job.project == project and job.status in JOB_UNFINISHED_STATUSES:
                return job
    return None


def job_creation_payload(job):
    with JOBS_LOCK:
        return {
            "id": job.id,
            "title": job.title,
            "project": job.project,
            "status": job.status,
            "started_at": job.started_at,
            "lines": job.lines[-JOB_LINES_LIMIT:],
            **job_cancel_payload(job),
        }


def job_cancel_payload(job):
    """Ce que l'interface peut proposer pour arrêter l'action ; appelé sous JOBS_LOCK."""
    irreversible = job.control.irreversible_step if job.status == "running" else ""
    return {
        "cancellable": job.status == "queued" or (job.status == "running" and job.cancellable and not irreversible),
        "cancel_hint": job.cancel_hint,
        "cancel_blocked_step": irreversible,
        "cancel_pending_step": job.control.protected_step if job.status == "cancelling" else "",
        "waiting_for": job_waiting_reason(job) if job.status == "queued" else "",
    }


def clear_jobs_history():
    with JOBS_LOCK:
        running = {job_id: job for job_id, job in JOBS.items() if job.status in JOB_UNFINISHED_STATUSES}
        JOBS.clear()
        JOBS.update(running)
    notify_jobs_changed()
    persist_job_history()
    return len(running)


def delete_job_history(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            raise ValueError("Action introuvable.")
        if job.status in JOB_UNFINISHED_STATUSES:
            raise ValueError("Impossible de supprimer une action en cours ou en attente : arrête-la d'abord.")
        del JOBS[job_id]
    notify_jobs_changed()
    persist_job_history()


def persist_job_history():
    """Réécrit l'historique : les actions survivent au redémarrage du gestionnaire, ou à son plantage."""
    path = JOB_HISTORY_PATH
    if path is None:
        return
    # L'état est relevé sous le verrou d'écriture : un relevé plus ancien ne peut pas écraser un plus récent.
    with JOB_HISTORY_LOCK:
        with JOBS_LOCK:
            records = [job.history_record() for job in JOBS.values()]
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps({"version": 1, "jobs": records}, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, path)
        except OSError:
            traceback.print_exc()


def load_job_history(path):
    """Relit l'historique au démarrage et active son enregistrement ; un fichier illisible repart de zéro."""
    global JOB_HISTORY_PATH, NEXT_JOB_ID
    JOB_HISTORY_PATH = path
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        records = payload.get("jobs", []) if isinstance(payload, dict) else []
    except FileNotFoundError:
        return 0
    except (OSError, ValueError):
        traceback.print_exc()
        return 0
    restored = []
    for record in records[-MAX_RETAINED_JOBS:]:
        try:
            restored.append(Job.from_history(record))
        except (KeyError, TypeError, ValueError):
            continue
    with JOBS_LOCK:
        for job in sorted(restored, key=lambda item: item.id):
            JOBS.setdefault(job.id, job)
        NEXT_JOB_ID = max([NEXT_JOB_ID, *(job_id + 1 for job_id in JOBS)])
    # Les actions interrompues sont enregistrées comme telles, pas relues « en cours » au prochain démarrage.
    persist_job_history()
    return len(restored)


def notify_jobs_changed():
    JOBS_CHANGED.set()


def jobs_event_loop():
    """Prévient l'interface qu'une action a bougé ; elle relit alors /api/jobs, sortie incrémentale comprise."""
    while True:
        JOBS_CHANGED.wait()
        JOBS_CHANGED.clear()
        publish_event("jobs_changed", {})
        time.sleep(JOBS_EVENT_MIN_INTERVAL_SECONDS)
