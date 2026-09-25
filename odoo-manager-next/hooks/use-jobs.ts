"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { sendTaskNotification } from "@/lib/desktop-runtime";
import { type JobOutputCache, mergeIncrementalJobOutput } from "@/lib/job-output";
import { isJobUnfinished, jobCompletionTitle, jobsFingerprint } from "@/lib/jobs";
import type { Job, Toast } from "@/lib/types";

type UseJobsOptions = {
  pushToast: (kind: Toast["kind"], message: string) => void;
  markApiSuccess: () => void;
  markApiFailure: (error: unknown) => boolean;
};

/**
 * Actions du gestionnaire : liste, action suivie, lecture incrémentale de sa sortie et
 * notification de fin. Le rythme des relectures appartient à l'appelant (flux, filet de secours).
 */
export function useJobs({ pushToast, markApiSuccess, markApiFailure }: UseJobsOptions) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  // Lue par les relectures en cours : l'état React ne l'est qu'au rendu suivant.
  const selectedJobIdRef = useRef<number | null>(null);
  const jobOutputCache = useRef<JobOutputCache>(new Map());
  // Dernier statut connu de chaque action : une action qui passe de « en cours » à terminée est notifiée une fois.
  const jobStatuses = useRef<Map<number, string>>(new Map());
  const jobNotificationsInitialized = useRef(false);
  const jobsRefreshInFlight = useRef(false);
  // Changement signalé pendant une lecture : relu à sa fin, sinon la dernière ligne attendrait le prochain signal.
  const jobsRefreshQueued = useRef(false);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  const hasRunningJobs = useMemo(() => jobs.some(isJobUnfinished), [jobs]);
  const runningJobs = useMemo(() => jobs.filter(isJobUnfinished), [jobs]);

  const notifyJobCompletion = useCallback(
    (job: Job) => {
      const successful = job.status === "done";
      const title = `${jobCompletionTitle(job)} : ${job.title}`;
      const message = !successful && job.error_message ? `${title}\n${job.error_message}` : title;
      pushToast(successful ? "success" : job.status === "cancelled" ? "info" : "error", message);
      void sendTaskNotification(job).catch(() => {
        // A refused system permission must not affect job polling.
      });
    },
    [pushToast],
  );

  /** Applique une liste reçue ; `notify` à faux au démarrage, pour ne pas annoncer des actions déjà finies. */
  const applyJobs = useCallback(
    (receivedJobs: Job[], notify = true) => {
      const nextJobs = mergeIncrementalJobOutput(receivedJobs, jobOutputCache.current);
      const previousStatuses = jobStatuses.current;
      if (notify && jobNotificationsInitialized.current) {
        for (const job of nextJobs) {
          const previousStatus = previousStatuses.get(job.id);
          if (previousStatus && isJobUnfinished({ status: previousStatus }) && !isJobUnfinished(job)) {
            notifyJobCompletion(job);
          }
        }
      }
      jobStatuses.current = new Map(nextJobs.map((job) => [job.id, job.status]));
      jobNotificationsInitialized.current = true;
      setJobs((current) => (jobsFingerprint(current) === jobsFingerprint(nextJobs) ? current : nextJobs));
    },
    [notifyJobCompletion],
  );

  const refreshJobs = useCallback(
    async (detailJobId?: number | null) => {
      if (jobsRefreshInFlight.current) {
        jobsRefreshQueued.current = true;
        return;
      }
      jobsRefreshInFlight.current = true;
      try {
        let requestedJobId = detailJobId ?? selectedJobIdRef.current;
        do {
          jobsRefreshQueued.current = false;
          const knownOutput = requestedJobId ? jobOutputCache.current.get(requestedJobId) : undefined;
          const params = new URLSearchParams();
          if (requestedJobId) params.set("detail", String(requestedJobId));
          if (requestedJobId && knownOutput?.total) params.set("output_from", String(knownOutput.total));
          const query = params.size ? `?${params}` : "";
          const payload = await api<{ jobs: Job[] }>(`/api/jobs${query}`);
          applyJobs(payload.jobs);
          markApiSuccess();
          setSelectedJobId((currentId) => currentId ?? payload.jobs[0]?.id ?? null);
          requestedJobId = selectedJobIdRef.current;
        } while (jobsRefreshQueued.current);
      } catch (err) {
        markApiFailure(err);
        // Jobs polling should not break the whole screen.
      } finally {
        jobsRefreshInFlight.current = false;
      }
    },
    [applyJobs, markApiFailure, markApiSuccess],
  );

  /** Action tout juste créée : elle devient l'action suivie, et sa fin sera notifiée. */
  const trackCreatedJob = useCallback((job: Job) => {
    setSelectedJobId(job.id);
    jobStatuses.current.set(job.id, job.status);
  }, []);

  /** Suit une action choisie par l'utilisateur et relit aussitôt sa sortie complète. */
  const focusJob = useCallback(
    (jobId: number) => {
      setSelectedJobId(jobId);
      selectedJobIdRef.current = jobId;
      void refreshJobs(jobId);
    },
    [refreshJobs],
  );

  return {
    jobs,
    selectedJobId,
    setSelectedJobId,
    hasRunningJobs,
    runningJobs,
    applyJobs,
    refreshJobs,
    trackCreatedJob,
    focusJob,
  };
}
