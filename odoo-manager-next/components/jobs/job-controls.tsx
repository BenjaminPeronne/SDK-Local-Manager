"use client";

import type { ReactNode } from "react";
import { Loader2, Square, X } from "lucide-react";
import { jobStopUnavailableReason } from "@/lib/jobs";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function JobProgressPanel({ label, percent, action }: { label: string; percent: number | null; action?: ReactNode }) {
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 rounded-md border border-emerald-400/20 bg-slate-950 px-3 py-2.5 text-emerald-100">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-400" />
          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
          {percent !== null && <span className="shrink-0 tabular-nums text-emerald-300">{percent}%</span>}
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={percent !== null ? 100 : undefined}
          aria-valuenow={percent ?? undefined}
        >
          {percent !== null ? (
            <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-400" />
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

// Rouge comme les autres actions destructives ; le carré est plein, symbole « stop » des lecteurs :
// vide et gris, il se lisait comme une case à cocher.
const STOP_BUTTON_CLASS =
  "border-red-300 text-red-700 hover:border-red-400 hover:bg-red-50 hover:text-red-800 active:bg-red-100 focus-visible:ring-red-500 dark:border-red-800 dark:text-red-300 dark:hover:border-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-200 dark:active:bg-red-950";

export function JobStopButton({ job, className, onRequest }: { job: Job; className?: string; onRequest: (jobId: number) => void }) {
  const queued = job.status === "queued";
  const cancelling = job.status === "cancelling";
  const unavailable = jobStopUnavailableReason(job);
  const label = queued ? "Retirer de la file" : cancelling ? "Arrêt en cours…" : "Arrêter l'action";
  const title = unavailable || `${queued ? "Retirer de la file d'attente" : "Arrêter"} : ${job.title}`;
  const icon = cancelling ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : queued ? (
    <X className="h-4 w-4" />
  ) : (
    <Square className="h-3.5 w-3.5 fill-current" />
  );
  return (
    <Button
      className={cn(STOP_BUTTON_CLASS, className)}
      variant="outline"
      size="sm"
      title={title}
      aria-label={title}
      disabled={Boolean(unavailable)}
      onClick={() => onRequest(job.id)}
    >
      {icon}
      {label}
    </Button>
  );
}

export function JobCancelState({ job, action }: { job: Job; action?: ReactNode }) {
  if (job.status === "queued") {
    return (
      <div className="mb-3 flex flex-wrap items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">En attente</p>
          <p className="mt-0.5 break-words text-muted-foreground">
            {job.waiting_for || "Une autre action occupe ce projet"} : l’action démarrera automatiquement.
          </p>
        </div>
        {action}
      </div>
    );
  }
  if (job.status !== "cancelling") return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.08] p-3 text-sm">
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
      <div className="min-w-0">
        <p className="font-medium">Arrêt en cours</p>
        <p className="mt-0.5 break-words text-muted-foreground">
          {job.cancel_pending_step
            ? `L'arrêt sera effectif à la fin de l'étape en cours : ${job.cancel_pending_step}.`
            : job.cancel_hint}
        </p>
      </div>
    </div>
  );
}
