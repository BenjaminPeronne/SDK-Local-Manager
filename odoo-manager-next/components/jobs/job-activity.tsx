"use client";

import { ChevronRight, Clock, Loader2 } from "lucide-react";
import { isJobActive } from "@/lib/jobs";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

// Libellé par défaut du backend (job_progress.DEFAULT_LABEL) : le spinner le dit déjà.
const GENERIC_PROGRESS_LABEL = "Traitement en cours";

/** Étape en cours d'une action, ou ce qu'elle attend pour commencer ; vide sans étape précise. */
export function jobStepText(job: Job) {
  if (job.status === "cancelling") return "Arrêt en cours";
  if (!isJobActive(job)) return job.waiting_for ? `En attente · ${job.waiting_for}` : "En attente";
  const label = job.progress?.label ?? "";
  return label === GENERIC_PROGRESS_LABEL ? "" : label;
}

function JobProgressBar({ job, className }: { job: Job; className?: string }) {
  const active = isJobActive(job);
  // Une action qui démarre affiche déjà un trait : une barre vide passait pour un blocage.
  const percent = active ? Math.max(3, Math.min(100, job.progress?.percent ?? 0)) : 0;
  return (
    <span
      className={cn("block h-1 overflow-hidden rounded-full bg-primary/15", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={active ? percent : undefined}
      aria-label={job.title}
    >
      <span
        className="block h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

function JobStateIcon({ job, className }: { job: Job; className?: string }) {
  return isJobActive(job) ? (
    <Loader2 className={cn("h-4 w-4 shrink-0 animate-spin text-primary", className)} aria-hidden="true" />
  ) : (
    <Clock className={cn("h-4 w-4 shrink-0 text-muted-foreground", className)} aria-hidden="true" />
  );
}

/**
 * Actions en cours du projet ouvert, une ligne chacune : ce qui tourne, où il en est, et le lien
 * vers son journal. Les actions des autres projets restent dans la barre latérale.
 */
export function ProjectActivity({ jobs, onFollowJob }: { jobs: Job[]; onFollowJob: (job: Job) => void }) {
  if (!jobs.length) return null;
  return (
    <div className="mb-4 grid gap-2" aria-live="polite">
      {jobs.map((job) => (
        <button
          key={job.id}
          type="button"
          className="group grid w-full gap-1.5 rounded-md border border-primary/25 bg-primary/[0.05] px-3 py-2 text-left text-sm transition-colors hover:border-primary/45 hover:bg-primary/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-primary/[0.1]"
          title={`Suivre : ${job.title}`}
          onClick={() => onFollowJob(job)}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <JobStateIcon job={job} />
            <span className="min-w-0 flex-1 truncate font-medium">{job.title}</span>
            {jobStepText(job) && (
              <span className="hidden min-w-0 max-w-[45%] truncate text-xs text-muted-foreground sm:block">
                {jobStepText(job)}
              </span>
            )}
            {isJobActive(job) && job.progress && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{job.progress.percent} %</span>
            )}
            <span className="flex shrink-0 items-center text-xs font-medium text-primary">
              Suivre
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </span>
          </span>
          <JobProgressBar job={job} />
        </button>
      ))}
    </div>
  );
}

/**
 * Actions qui ne concernent aucun projet (espace disque, Docker Desktop, Traefik…), en bas de la
 * barre latérale : visibles d'où que l'on soit, sans bandeau dans la page.
 */
export function GeneralActivity({ jobs, className }: { jobs: Job[]; className?: string }) {
  if (!jobs.length) return null;
  return (
    <div className={cn("grid gap-2 rounded-md border bg-muted/35 p-2.5 text-xs", className)} aria-live="polite">
      {jobs.map((job) => (
        <div key={job.id} className="grid gap-1.5" title={[job.title, jobStepText(job)].filter(Boolean).join(" · ")}>
          <span className="flex min-w-0 items-center gap-2">
            <JobStateIcon job={job} className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate font-medium">{job.title}</span>
            {isJobActive(job) && job.progress && (
              <span className="shrink-0 tabular-nums text-muted-foreground">{job.progress.percent} %</span>
            )}
          </span>
          <JobProgressBar job={job} />
        </div>
      ))}
    </div>
  );
}
