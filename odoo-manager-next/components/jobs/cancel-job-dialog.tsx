"use client";

import type { Dispatch, SetStateAction } from "react";
import { Square, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Job, Toast } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type CancelJobDialogProps = {
  jobs: Job[];
  jobToCancelId: number | null;
  pushToast: (kind: Toast["kind"], message: string) => void;
  refreshJobs: (detailJobId?: number | null) => Promise<void>;
  setJobToCancelId: Dispatch<SetStateAction<number | null>>;
};

export function CancelJobDialog({
  jobs,
  jobToCancelId,
  pushToast,
  refreshJobs,
  setJobToCancelId,
}: CancelJobDialogProps) {
  async function confirmCancelJob() {
    const job = jobs.find((item) => item.id === jobToCancelId);
    setJobToCancelId(null);
    if (!job) return;
    try {
      const result = await api<{ job: Job }>(`/api/jobs/${job.id}/cancel`, { method: "POST", body: "{}" });
      pushToast(
        "info",
        result.job.status === "cancelled"
          ? `Action retirée de la file d'attente : ${job.title}`
          : `Arrêt demandé : ${job.title}`,
      );
      await refreshJobs(job.id);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Arrêt de l'action impossible.");
      void refreshJobs(job.id);
    }
  }
  const jobToCancel = jobs.find((job) => job.id === jobToCancelId) || null;

  return (
    <Dialog
      open={Boolean(jobToCancel)}
      onOpenChange={(open) => {
        if (!open) setJobToCancelId(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {jobToCancel?.status === "queued" ? "Retirer l'action de la file d'attente" : "Arrêter l'action"}
          </DialogTitle>
          <DialogDescription className="break-words">{jobToCancel?.title}</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          {jobToCancel?.status === "queued"
            ? "L'action n'a pas encore démarré : elle est simplement retirée, rien n'est modifié."
            : jobToCancel?.cancel_hint}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setJobToCancelId(null)}>
            Laisser continuer
          </Button>
          <Button variant="destructive" disabled={!jobToCancel?.cancellable} onClick={confirmCancelJob}>
            {jobToCancel?.status === "queued" ? (
              <X className="h-4 w-4" />
            ) : (
              <Square className="h-3.5 w-3.5 fill-current" />
            )}
            {jobToCancel?.status === "queued" ? "Retirer" : "Arrêter"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
