"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { Overview, SystemStatus } from "@/lib/types";

type UseLiveUpdatesOptions = {
  // Rien n'est lu ni écouté tant que le démarrage n'a pas abouti.
  initializing: boolean;
  hasRunningJobs: boolean;
  dockerPollInterval: number | undefined;
  refreshJobs: () => Promise<void>;
  refreshOverview: () => Promise<void>;
  refreshSystemStatus: () => Promise<void>;
  applyOverview: (payload: Overview) => void;
  commitSystemStatus: (payload: SystemStatus) => boolean;
};

/**
 * Mises à jour en direct : le flux /api/stream pousse l'état général, l'état système et les
 * signaux d'actions ; des relectures périodiques, seulement quand la fenêtre est visible,
 * rattrapent ce qu'une coupure du flux aurait fait manquer.
 */
export function useLiveUpdates({
  initializing,
  hasRunningJobs,
  dockerPollInterval,
  refreshJobs,
  refreshOverview,
  refreshSystemStatus,
  applyOverview,
  commitSystemStatus,
}: UseLiveUpdatesOptions) {
  const [jobsStreamConnected, setJobsStreamConnected] = useState(false);

  useEffect(() => {
    if (initializing) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshJobs();
    };
    // Flux connecté, le signal jobs_changed suffit : la lecture périodique ne sert que de filet.
    const interval = jobsStreamConnected ? 10000 : hasRunningJobs ? 1200 : 10000;
    const timer = window.setInterval(refreshWhenVisible, interval);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [hasRunningJobs, initializing, jobsStreamConnected, refreshJobs]);

  useEffect(() => {
    if (initializing) return;
    // Safety-net fallback only: /api/stream (below) pushes overview changes live.
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshOverview();
    };
    const timer = window.setInterval(refreshWhenVisible, hasRunningJobs ? 15000 : 45000);
    return () => window.clearInterval(timer);
  }, [hasRunningJobs, initializing, refreshOverview]);

  useEffect(() => {
    if (initializing) return;
    // Safety-net fallback only: /api/stream (below) pushes system status changes live.
    const interval = Math.max(3, dockerPollInterval || 10) * 1000 * 3;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshSystemStatus();
    };
    const timer = window.setInterval(refreshWhenVisible, interval);
    return () => window.clearInterval(timer);
  }, [initializing, refreshSystemStatus, dockerPollInterval]);

  useEffect(() => {
    if (initializing || typeof EventSource === "undefined") return;
    const source = new EventSource(`${API_BASE}/api/stream`);
    source.onopen = () => {
      setJobsStreamConnected(true);
      // Les signaux perdus pendant une coupure sont rattrapés en une lecture.
      void refreshJobs();
    };
    source.onerror = () => setJobsStreamConnected(false);
    source.addEventListener("jobs_changed", () => {
      if (document.visibilityState === "visible") void refreshJobs();
    });
    source.addEventListener("overview", (event) => {
      try {
        applyOverview(JSON.parse((event as MessageEvent<string>).data) as Overview);
      } catch {
        // Malformed live update: the safety-net poll will resync state.
      }
    });
    source.addEventListener("system_status", (event) => {
      try {
        commitSystemStatus(JSON.parse((event as MessageEvent<string>).data) as SystemStatus);
      } catch {
        // Malformed live update: the safety-net poll will resync state.
      }
    });
    source.addEventListener("job_completed", () => {
      // Applying completed jobs triggers the module synchronization effect.
      // Fetching modules here as well duplicated the filesystem/SQL scan.
      void Promise.all([refreshJobs(), refreshOverview()]);
    });
    return () => {
      source.close();
      setJobsStreamConnected(false);
    };
  }, [applyOverview, commitSystemStatus, initializing, refreshJobs, refreshOverview]);
}
