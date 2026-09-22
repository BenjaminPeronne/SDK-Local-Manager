import type { Job } from "@/lib/types";

export function jobsFingerprint(items: Job[]) {
  return items
    .map(
      (job) =>
        `${job.id}:${job.status}:${job.finished_at || ""}:${job.error_message || ""}:${job.lines.length}:${job.last_line ?? job.lines.at(-1) ?? ""}:${job.output_total ?? job.output?.length ?? 0}:${job.progress?.label || ""}:${job.progress?.current ?? ""}:${job.progress?.total ?? ""}`,
    )
    .join("|");
}

// En cours d'exécution, arrêt compris : le serveur tient encore des ressources du projet.
export function isJobActive(job: Pick<Job, "status">) {
  return job.status === "running" || job.status === "cancelling";
}

// Pas encore terminée : en attente, en cours ou en train de s'arrêter.
export function isJobUnfinished(job: Pick<Job, "status">) {
  return job.status === "queued" || isJobActive(job);
}

export function jobCompletionTitle(job: Job) {
  if (job.status === "done") return "Tâche terminée";
  if (job.status === "cancelled") return "Tâche arrêtée";
  return "Tâche en erreur";
}

export function jobStopUnavailableReason(job: Job) {
  if (job.status === "cancelling") return "Arrêt en cours : retour arrière des modifications de l'action.";
  if (job.cancel_blocked_step) return `Arrêt impossible pendant une étape irréversible : ${job.cancel_blocked_step}.`;
  if (!job.cancellable)
    return `Cette action ne peut pas être arrêtée : ${job.cancel_hint || "opération non interruptible."}`;
  return "";
}

// Titres des jobs qui font apparaître un projet dans le workspace. Une entrée provisoire
// les accompagne : sans elle, « Suivre » sélectionnait un projet encore inexistant et
// laissait l'écran d'accueil affiché, sans rien ouvrir.
export const MIGRATION_JOB_PREFIX = "Migrer ";

export const PROJECT_ARRIVAL_PREFIXES = ["Créer le projet ", MIGRATION_JOB_PREFIX] as const;
