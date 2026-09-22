"use client";

import { Loader2, Logs } from "lucide-react";
import type { Job } from "@/lib/types";
import { Button } from "@/components/ui/button";

type RunningJobsBannerProps = {
  onFollowJob: (job: Job) => void;
  runningJobs: Job[];
};

export function RunningJobsBanner({ onFollowJob, runningJobs }: RunningJobsBannerProps) {
  return (
    <div className="mb-4 rounded-md border border-primary/35 bg-primary/[0.08] p-3 text-sm shadow-sm dark:bg-primary/[0.14]">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {runningJobs.length === 1 ? "Un traitement est en cours" : `${runningJobs.length} traitements sont en cours`}
          </p>
          <p className="mt-0.5 text-muted-foreground">
            Les paramètres sont temporairement verrouillés. Ouvre le suivi pour savoir ce qui est exécuté.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {runningJobs.map((job) => (
              <Button
                key={job.id}
                size="sm"
                variant="outline"
                className="max-w-full bg-background/70"
                title={`Suivre : ${job.title}`}
                onClick={() => onFollowJob(job)}
              >
                <Logs className="h-4 w-4" />
                <span className="max-w-72 truncate">Suivre : {job.title}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
