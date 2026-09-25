"use client";

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, ApiUnavailableError, configureRuntimeApiBase } from "@/lib/api";
import { invokeDesktop, isDesktopRuntime } from "@/lib/desktop-runtime";
import type {
  BackendDiagnostics,
  BootstrapSnapshot,
  Job,
  ManagerSettings,
  Overview,
  SystemStatus,
  Toast,
} from "@/lib/types";
import { delay } from "@/lib/utils";

const BOOTSTRAP_RETRY_DELAYS_MS = [0, 500, 1000, 2000];

const DOCKER_CONFIRM_DELAY_MS = 700;

type UseManagerStateOptions = {
  pushToast: (kind: Toast["kind"], message: string) => void;
  markApiSuccess: () => void;
  markApiFailure: (error: unknown) => boolean;
  applyJobs: (jobs: Job[], notify?: boolean) => void;
  setSelectedJobId: Dispatch<SetStateAction<number | null>>;
  setSelectedProjectName: Dispatch<SetStateAction<string>>;
  // Projets en cours de création : ils restent sélectionnés avant d'apparaître dans la liste.
  pendingProjectNames: MutableRefObject<Set<string>>;
};

/**
 * État du gestionnaire lu sur le service local : démarrage et ses nouvelles tentatives, liste des
 * projets, état système (Docker, Traefik) et réglages. Les mises à jour en direct passent par
 * applyOverview et commitSystemStatus (voir useLiveUpdates).
 */
export function useManagerState({
  pushToast,
  markApiSuccess,
  markApiFailure,
  applyJobs,
  setSelectedJobId,
  setSelectedProjectName,
  pendingProjectNames,
}: UseManagerStateOptions) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [settings, setSettings] = useState<ManagerSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ManagerSettings | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [initializationMessage, setInitializationMessage] = useState("Démarrage du service local…");
  const [initializationError, setInitializationError] = useState("");
  const [backendDiagnostics, setBackendDiagnostics] = useState<BackendDiagnostics | null>(null);
  const [error, setError] = useState("");
  const lastDockerState = useRef<string | null>(null);
  const pendingDockerState = useRef<{ state: string; count: number } | null>(null);
  const initializingRef = useRef(true);
  const bootstrapGeneration = useRef(0);
  const overviewRefreshInFlight = useRef(false);
  const systemRefreshInFlight = useRef(false);

  const applyBootstrapSnapshot = useCallback(
    (payload: BootstrapSnapshot) => {
      setOverview(payload.overview);
      setSystemStatus(payload.system_status);
      setSettings(payload.settings);
      setSettingsDraft(payload.settings);
      applyJobs(payload.jobs, false);
      setSelectedProjectName((currentName) => {
        if (currentName && pendingProjectNames.current.has(currentName)) return currentName;
        // Un projet disparu (supprimé, renommé) ramène à l'accueil plutôt qu'au premier de la liste.
        const project = payload.overview.projects.find((item) => item.name === currentName);
        return project?.name || "";
      });
      setSelectedJobId((currentId) =>
        payload.jobs.some((job) => job.id === currentId) ? currentId : (payload.jobs[0]?.id ?? null),
      );
      lastDockerState.current = payload.system_status.docker.state;
      pendingDockerState.current = null;
      markApiSuccess();
      setError("");
    },
    [applyJobs, markApiSuccess, pendingProjectNames, setSelectedJobId, setSelectedProjectName],
  );

  const commitSystemStatus = useCallback(
    (payload: SystemStatus, immediate = false) => {
      markApiSuccess();
      const previous = lastDockerState.current;
      const next = payload.docker.state;
      const sameState = previous === next;
      const recoverToReady = payload.docker.running;

      if (!immediate && previous && !sameState && !recoverToReady) {
        const pending = pendingDockerState.current;
        const count = pending?.state === next ? pending.count + 1 : 1;
        pendingDockerState.current = { state: next, count };
        if (count < 2) return false;
      }

      pendingDockerState.current = null;
      setSystemStatus(payload);
      if (!immediate && previous && previous !== next) {
        if (payload.docker.running) pushToast("success", "Docker est maintenant disponible.");
        else pushToast("error", payload.docker.message || "Docker n'est plus disponible.");
      }
      lastDockerState.current = next;
      return true;
    },
    [markApiSuccess, pushToast],
  );

  const initializeApplication = useCallback(async () => {
    const generation = ++bootstrapGeneration.current;
    initializingRef.current = true;
    setInitializing(true);
    setInitializationError("");
    setBackendDiagnostics(null);
    markApiSuccess();

    for (const [attempt, retryDelay] of BOOTSTRAP_RETRY_DELAYS_MS.entries()) {
      if (retryDelay) await delay(retryDelay);
      if (generation !== bootstrapGeneration.current) return;
      setInitializationMessage(attempt === 0 ? "Démarrage du service local…" : "Connexion au service local…");
      try {
        let payload = await api<BootstrapSnapshot>("/api/bootstrap");
        if (!payload.system_status.docker.running) {
          setInitializationMessage("Vérification de Docker et des projets…");
          await delay(DOCKER_CONFIRM_DELAY_MS);
          const confirmation = await api<BootstrapSnapshot>("/api/bootstrap");
          if (
            confirmation.system_status.docker.state !== payload.system_status.docker.state &&
            !confirmation.system_status.docker.running
          ) {
            await delay(DOCKER_CONFIRM_DELAY_MS);
            payload = await api<BootstrapSnapshot>("/api/bootstrap");
          } else {
            payload = confirmation;
          }
        }
        if (generation !== bootstrapGeneration.current) return;
        applyBootstrapSnapshot(payload);
        initializingRef.current = false;
        setInitializing(false);
        return;
      } catch (err) {
        if (generation !== bootstrapGeneration.current) return;
        if (attempt === BOOTSTRAP_RETRY_DELAYS_MS.length - 1) {
          setInitializationError(err instanceof Error ? err.message : "Le service local ne répond pas.");
          setInitializationMessage("Le gestionnaire n’est pas encore prêt.");
          if (isDesktopRuntime()) {
            try {
              setBackendDiagnostics(await invokeDesktop<BackendDiagnostics>("backend_diagnostics"));
            } catch {
              setBackendDiagnostics(null);
            }
          }
        }
      }
    }
  }, [applyBootstrapSnapshot, markApiSuccess]);

  const applyOverview = useCallback(
    (payload: Overview) => {
      setOverview((currentOverview) =>
        currentOverview && JSON.stringify(currentOverview) === JSON.stringify(payload) ? currentOverview : payload,
      );
      markApiSuccess();
      setError("");
      setSelectedProjectName((currentName) => {
        if (currentName && pendingProjectNames.current.has(currentName)) return currentName;
        const current = payload.projects.find((project) => project.name === currentName);
        return current?.name || "";
      });
    },
    [markApiSuccess, pendingProjectNames, setSelectedProjectName],
  );

  const refreshOverview = useCallback(async () => {
    if (overviewRefreshInFlight.current) return;
    overviewRefreshInFlight.current = true;
    try {
      const payload = await api<Overview>("/api/overview");
      applyOverview(payload);
    } catch (err) {
      markApiFailure(err);
      setError(
        !initializingRef.current && !(err instanceof ApiUnavailableError)
          ? err instanceof Error
            ? err.message
            : "Impossible de charger l'overview."
          : "",
      );
    } finally {
      overviewRefreshInFlight.current = false;
    }
  }, [applyOverview, markApiFailure]);

  const refreshSystemStatus = useCallback(async () => {
    if (systemRefreshInFlight.current) return;
    systemRefreshInFlight.current = true;
    try {
      const payload = await api<SystemStatus>("/api/system/status");
      commitSystemStatus(payload);
    } catch (err) {
      const newlyUnavailable = markApiFailure(err);
      if (!initializingRef.current && (newlyUnavailable || !(err instanceof ApiUnavailableError))) {
        pushToast("error", err instanceof Error ? err.message : "État système indisponible.");
      }
    } finally {
      systemRefreshInFlight.current = false;
    }
  }, [commitSystemStatus, markApiFailure, pushToast]);

  const loadSettings = useCallback(async () => {
    try {
      const payload = await api<{ settings: ManagerSettings }>("/api/settings");
      setSettings(payload.settings);
      setSettingsDraft(payload.settings);
      markApiSuccess();
    } catch (err) {
      markApiFailure(err);
      if (!initializingRef.current && !(err instanceof ApiUnavailableError)) {
        pushToast("error", err instanceof Error ? err.message : "Paramètres indisponibles.");
      }
    }
  }, [markApiFailure, markApiSuccess, pushToast]);

  /** Réglages enregistrés : ils deviennent aussi le brouillon du dialogue. */
  const applySettings = useCallback((nextSettings: ManagerSettings) => {
    setSettings(nextSettings);
    setSettingsDraft(nextSettings);
  }, []);

  useEffect(() => {
    void configureRuntimeApiBase()
      .then(initializeApplication)
      .catch((err) => {
        setInitializationError(
          err instanceof Error ? err.message : "Impossible de déterminer le port du gestionnaire.",
        );
        setInitializationMessage("Le gestionnaire n’est pas encore prêt.");
      });
    return () => {
      bootstrapGeneration.current += 1;
    };
  }, []);

  return {
    overview,
    systemStatus,
    settings,
    setSettings,
    settingsDraft,
    setSettingsDraft,
    applySettings,
    initializing,
    initializationMessage,
    initializationError,
    backendDiagnostics,
    error,
    initializeApplication,
    applyOverview,
    commitSystemStatus,
    refreshOverview,
    refreshSystemStatus,
    loadSettings,
  };
}
