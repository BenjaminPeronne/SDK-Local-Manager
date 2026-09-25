"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Boxes, Database, Logs, Settings } from "lucide-react";
import { useApiAvailability } from "@/hooks/use-api-availability";
import { useHiddenBelowStickyHeader } from "@/hooks/use-hidden-below-sticky-header";
import { useJobs } from "@/hooks/use-jobs";
import { useModuleFilters } from "@/hooks/use-module-filters";
import { useScheduledTimeouts } from "@/hooks/use-scheduled-timeouts";
import { useStickyProjectHeader } from "@/hooks/use-sticky-project-header";
import { useToasts } from "@/hooks/use-toasts";
import {
  api,
  API_BASE,
  ApiUnavailableError,
  configureRuntimeApiBase,
  isProjectGone,
  uploadDatabaseBackup,
} from "@/lib/api";
import { databaseToKeep, readRememberedDatabases, writeRememberedDatabases } from "@/lib/database-selection";
import {
  desktopBridge,
  desktopErrorMessage,
  type GitLabStatus,
  type StoredRikaCredentials,
  type WslStatus,
} from "@/lib/desktop";
import {
  applicationVersion,
  FALLBACK_APP_VERSION,
  invokeDesktop,
  isDesktopRuntime,
  openDockerDesktopNative,
  openExternalUrl,
  requestTaskNotificationPermission,
} from "@/lib/desktop-runtime";
import { isJobActive, isJobUnfinished, PROJECT_ARRIVAL_PREFIXES } from "@/lib/jobs";
import { moduleRepositoryUrlError, socleAppInstalled } from "@/lib/modules";
import { fallbackManagerSettings, firstOdooDatabase } from "@/lib/projects";
import type {
  AddonLinksStatus,
  BackendDiagnostics,
  BootstrapSnapshot,
  DatabaseMenuAction,
  ExternalLogView,
  FilestoreStatus,
  Job,
  ManagerErrorEntry,
  ManagerSettings,
  MigrationSnapshot,
  ModuleInfo,
  Overview,
  PendingDatabaseAction,
  PendingModuleOperation,
  ProjectCreationPrerequisites,
  ProjectDiagnostics,
  RestoreDatabasePayload,
  SocleCatalog,
  SocleInstallPlan,
  SshPublicKey,
  SystemStatus,
} from "@/lib/types";
import { cn, delay } from "@/lib/utils";
import { isWslSetupPending } from "@/lib/wsl-setup";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Notice } from "@/components/common/notice";
import { ToastStack } from "@/components/common/toast-stack";
import { AdminPasswordDialog } from "@/components/databases/admin-password-dialog";
import { AllTranslationsResetDialog } from "@/components/databases/all-translations-reset-dialog";
import { CreateDatabaseDialog } from "@/components/databases/create-database-dialog";
import { DatabasesTab } from "@/components/databases/databases-tab";
import { DropDatabaseDialog } from "@/components/databases/drop-database-dialog";
import { NeutralizeDatabaseDialog } from "@/components/databases/neutralize-database-dialog";
import { RestoreDatabaseDialog } from "@/components/databases/restore-database-dialog";
import { ActivityTab } from "@/components/jobs/activity-tab";
import { CancelJobDialog } from "@/components/jobs/cancel-job-dialog";
import { RunningJobsBanner } from "@/components/jobs/running-jobs-banner";
import { DeleteModuleCodeDialog } from "@/components/modules/delete-module-code-dialog";
import { ModuleSelectionBar, type ModuleSelectionBarProps } from "@/components/modules/module-selection-bar";
import { ModulesTab } from "@/components/modules/modules-tab";
import { RepositoryImportDialog } from "@/components/modules/repository-import-dialog";
import { SocleDialog } from "@/components/modules/socle-dialog";
import { TranslationResetDialog } from "@/components/modules/translation-reset-dialog";
import { UninstallModulesDialog } from "@/components/modules/uninstall-modules-dialog";
import { UpdateAllModulesDialog } from "@/components/modules/update-all-modules-dialog";
import { ZipImportDialog } from "@/components/modules/zip-import-dialog";
import { AddonLinksNotice } from "@/components/notices/addon-links-notice";
import { ApiUnavailableNotice } from "@/components/notices/api-unavailable-notice";
import { DegradedBackendNotice } from "@/components/notices/degraded-backend-notice";
import { DockerNotice } from "@/components/notices/docker-notice";
import { MigrationNotice } from "@/components/notices/migration-notice";
import { RefinedInterfaceNotice } from "@/components/notices/refined-interface-notice";
import { StagingCleanupNotice } from "@/components/notices/staging-cleanup-notice";
import { TraefikNotice } from "@/components/notices/traefik-notice";
import { OnboardingDialog } from "@/components/onboarding/onboarding-dialog";
import { SshKeyDialog } from "@/components/onboarding/ssh-key-dialog";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { DeleteProjectDialog } from "@/components/projects/delete-project-dialog";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectSettingsTab } from "@/components/projects/project-settings-tab";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import type { SettingsSectionId } from "@/components/settings/settings-section";
import { AboutDialog } from "@/components/shell/about-dialog";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { LoadingScreen } from "@/components/shell/loading-screen";
import { WelcomeScreen } from "@/components/welcome/welcome-screen";
import { WslSetupDialog } from "@/components/wsl-setup";
import appIcon from "./icon.png";
import localIcon from "./local-icon.png";

// Distance de défilement sur laquelle le bandeau des onglets collés passe de transparent à opaque.

const BOOTSTRAP_RETRY_DELAYS_MS = [0, 500, 1000, 2000];

const DOCKER_CONFIRM_DELAY_MS = 700;

// Au-delà, les plus anciennes lignes du suivi en direct sont oubliées : la mémoire et le rendu restent constants.
const LIVE_LOG_MAX_LINES = 2000;

export default function Home() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [addonLinks, setAddonLinks] = useState<AddonLinksStatus | null>(null);
  const [settings, setSettings] = useState<ManagerSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ManagerSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [managerErrors, setManagerErrors] = useState<ManagerErrorEntry[]>([]);
  const [managerErrorLogPath, setManagerErrorLogPath] = useState("");
  const [loadingManagerErrors, setLoadingManagerErrors] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [appVersion, setAppVersion] = useState(FALLBACK_APP_VERSION);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [wslSetupOpen, setWslSetupOpen] = useState(false);
  const [wslStatus, setWslStatus] = useState<WslStatus | null>(null);
  const [migration, setMigration] = useState<MigrationSnapshot | null>(null);
  // Fermeture simple : le bandeau revient au prochain démarrage. Le masquage définitif, lui,
  // est un réglage enregistré (migration_banner_dismissed).
  const [migrationBannerClosed, setMigrationBannerClosed] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [creationPrerequisites, setCreationPrerequisites] = useState<ProjectCreationPrerequisites | null>(null);
  const [loadingCreationPrerequisites, setLoadingCreationPrerequisites] = useState(false);
  const [sshDialogOpen, setSshDialogOpen] = useState(false);
  const [sshProvider, setSshProvider] = useState<"gitlab" | "github">("gitlab");
  const [sshKeys, setSshKeys] = useState<SshPublicKey[]>([]);
  const [selectedSshKeyName, setSelectedSshKeyName] = useState("");
  const [sshComment, setSshComment] = useState("");
  const [sshRegenerateMode, setSshRegenerateMode] = useState(false);
  const [sshRegenerateConfirmed, setSshRegenerateConfirmed] = useState(false);
  const [sshKeyBackup, setSshKeyBackup] = useState("");
  // Vide tant que l'utilisateur n'a pas choisi de projet : l'application s'ouvre sur l'accueil,
  // et Échap sur un projet éteint y revient en le refermant.
  const [selectedProjectName, setSelectedProjectName] = useState("");
  // Environnement Linux installé mais impossible à démarrer : le backend Windows a pris le relais.
  const [degradedBackendReason, setDegradedBackendReason] = useState("");
  const [wslBackend, setWslBackend] = useState(false);

  const [selectedDb, setSelectedDb] = useState("");
  // Base choisie pour chaque projet pendant la session : un rafraîchissement, une sonde Postgres
  // lente ou un aller-retour entre projets ne ramène plus à la première base de la liste.
  const rememberedDatabases = useRef<Record<string, string>>(readRememberedDatabases());
  // Projet auquel appartient `selectedDb` : à l'ouverture d'un autre projet, la base affichée
  // est encore celle du précédent et ne doit pas servir de référence.
  const databaseOwner = useRef("");
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());
  const [socleDialogOpen, setSocleDialogOpen] = useState(false);
  const [selectedSoclePresets, setSelectedSoclePresets] = useState<Set<string>>(new Set());
  const [socleCatalog, setSocleCatalog] = useState<SocleCatalog | null>(null);
  const [loadingSocleCatalog, setLoadingSocleCatalog] = useState(false);
  const [socleSearch, setSocleSearch] = useState("");
  const [soclePlan, setSoclePlan] = useState<SocleInstallPlan | null>(null);
  const [logDescriptionExpanded, setLogDescriptionExpanded] = useState(false);
  const [externalLogView, setExternalLogView] = useState<ExternalLogView | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingOdoo, setOpeningOdoo] = useState(false);
  const [openingPostgresql, setOpeningPostgresql] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [initializationMessage, setInitializationMessage] = useState("Démarrage du service local…");
  const [initializationError, setInitializationError] = useState("");
  const [backendDiagnostics, setBackendDiagnostics] = useState<BackendDiagnostics | null>(null);
  const [error, setError] = useState("");
  const [desktopRuntime, setDesktopRuntime] = useState(false);
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryBranch, setRepositoryBranch] = useState("");
  const [gitlabStatus, setGitlabStatus] = useState<GitLabStatus | null>(null);
  const repositoryUrlError = moduleRepositoryUrlError(repositoryUrl);
  const [zipDialogOpen, setZipDialogOpen] = useState(false);
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [restoreDbOpen, setRestoreDbOpen] = useState(false);
  const [neutralizeDbOpen, setNeutralizeDbOpen] = useState(false);
  const [dropDbOpen, setDropDbOpen] = useState(false);
  const [pendingDatabaseAction, setPendingDatabaseAction] = useState<PendingDatabaseAction | null>(null);
  const [postgresDetailsOpen, setPostgresDetailsOpen] = useState(false);
  const [rawOutputVisible, setRawOutputVisible] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [updateAllDialogOpen, setUpdateAllDialogOpen] = useState(false);
  const [updateScope, setUpdateScope] = useState<"imported" | "all">("all");
  const [updateFilestoreStatus, setUpdateFilestoreStatus] = useState<FilestoreStatus | null>(null);
  const [updatePendingModules, setUpdatePendingModules] = useState<PendingModuleOperation[]>([]);
  const [updateLocalExcludedModules, setUpdateLocalExcludedModules] = useState<string[]>([]);
  const [missingModulesToIgnore, setMissingModulesToIgnore] = useState<Set<string>>(new Set());
  const [allowMissingFilestore, setAllowMissingFilestore] = useState(false);
  const [checkingUpdatePrerequisites, setCheckingUpdatePrerequisites] = useState(false);
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);
  const [pendingTranslationResetModules, setPendingTranslationResetModules] = useState<string[]>([]);
  const [adminPasswordOpen, setAdminPasswordOpen] = useState(false);
  const [storedRikaCredentials, setStoredRikaCredentials] = useState<StoredRikaCredentials | null>(null);
  const [allTranslationsOpen, setAllTranslationsOpen] = useState(false);
  const [translationLanguages, setTranslationLanguages] = useState<{ code: string; name: string }[] | null>(null);
  const [selectedTranslationLanguages, setSelectedTranslationLanguages] = useState<Set<string>>(new Set());
  const [deleteCodeDialogOpen, setDeleteCodeDialogOpen] = useState(false);
  const [deleteCodeUninstallFirst, setDeleteCodeUninstallFirst] = useState(true);
  const [pendingUninstallModules, setPendingUninstallModules] = useState<string[]>([]);
  const [jobToCancelId, setJobToCancelId] = useState<number | null>(null);
  const [pendingDeleteCodeModules, setPendingDeleteCodeModules] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("bases");
  const [pendingCreatedProjectName, setPendingCreatedProjectName] = useState("");
  const [pendingCreatedDatabase, setPendingCreatedDatabase] = useState<{
    jobId: number;
    project: string;
    database: string;
  } | null>(null);
  const lastDockerState = useRef<string | null>(null);
  const pendingDockerState = useRef<{ state: string; count: number } | null>(null);
  const initializingRef = useRef(true);
  const bootstrapGeneration = useRef(0);
  const overviewRefreshInFlight = useRef(false);
  const systemRefreshInFlight = useRef(false);
  const [jobsStreamConnected, setJobsStreamConnected] = useState(false);
  const lastSynchronizedJobCompletion = useRef("");
  const modulesRequestGeneration = useRef(0);
  const schedule = useScheduledTimeouts();
  const { toasts, pushToast } = useToasts(schedule);
  const { apiUnavailable, markApiSuccess, markApiFailure } = useApiAvailability();
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    hasRunningJobs,
    runningJobs,
    applyJobs,
    refreshJobs,
    trackCreatedJob,
    focusJob,
  } = useJobs({ pushToast, markApiSuccess, markApiFailure });
  const onboardingPrompted = useRef(false);
  const wslSetupPrompted = useRef(false);
  const pendingProjectNames = useRef(new Set<string>());
  const logOutputRef = useRef<HTMLPreElement>(null);
  const previousSelectedJobRef = useRef<{ id: number | null; status: string | null }>({ id: null, status: null });
  const logAutoFollow = useRef(true);
  const lastLogOutputSource = useRef("");
  const logStreamRef = useRef<EventSource | null>(null);
  // Dernières lignes du flux de logs en direct, bornées ; null tant qu'aucune n'est arrivée.
  const logStreamLinesRef = useRef<string[] | null>(null);
  const logStreamFrameRef = useRef<number | null>(null);

  const stopLiveLogStream = useCallback(() => {
    logStreamRef.current?.close();
    logStreamRef.current = null;
    if (logStreamFrameRef.current !== null) window.cancelAnimationFrame(logStreamFrameRef.current);
    logStreamFrameRef.current = null;
  }, []);

  const scrollLogOutputToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      const output = logOutputRef.current;
      if (output) output.scrollTop = output.scrollHeight;
    });
  }, []);

  const enableLogAutoFollow = useCallback(() => {
    logAutoFollow.current = true;
    scrollLogOutputToBottom();
  }, [scrollLogOutputToBottom]);

  const selectedProject = useMemo(
    () => overview?.projects.find((project) => project.name === selectedProjectName),
    [overview, selectedProjectName],
  );
  const selectedAppIcon = settings?.interface_icon === "local" ? localIcon : appIcon;
  const odooDatabases = useMemo(
    () => (selectedProject?.databases || []).filter((database) => database !== "postgres"),
    [selectedProject],
  );

  const projectJobs = useMemo(
    () => jobs.filter((job) => job.project === selectedProjectName),
    [jobs, selectedProjectName],
  );
  const selectedJob = useMemo(
    () => projectJobs.find((job) => job.id === selectedJobId) || projectJobs[0],
    [projectJobs, selectedJobId],
  );
  const pendingProjectArrivals = useMemo(
    () =>
      jobs.filter(
        (job) =>
          isJobUnfinished(job) &&
          PROJECT_ARRIVAL_PREFIXES.some((prefix) => job.title.startsWith(prefix)) &&
          Boolean(job.project) &&
          !overview?.projects.some((project) => project.name === job.project),
      ),
    [jobs, overview?.projects],
  );
  const pendingSelectedProjectArrival = useMemo(
    () => pendingProjectArrivals.find((job) => job.project === selectedProjectName),
    [pendingProjectArrivals, selectedProjectName],
  );
  // Vue projet affichée (en-tête, onglets) ; sinon, l'accueil occupe la zone principale.
  const projectViewOpen = Boolean(selectedProject || pendingSelectedProjectArrival);
  const migrationCandidates = useMemo(
    () => (migration?.projects || []).filter((candidate) => !candidate.already_migrated),
    [migration],
  );
  // La proposition disparaît d'elle-même quand les projets ont quitté l'ancien dossier ; la
  // masquer ne fait que retirer le bandeau, jamais l'entrée des réglages.
  const migrationBannerVisible =
    Boolean(migration?.available) && migrationCandidates.length > 0 && !migration?.dismissed && !migrationBannerClosed;
  const traefikInstallRunning = jobs.some((job) => isJobUnfinished(job) && job.title === "Installer Traefik");
  const selectedSshKey = useMemo(
    () => sshKeys.find((key) => key.name === selectedSshKeyName) || sshKeys[0] || null,
    [selectedSshKeyName, sshKeys],
  );
  const moduleFilters = useModuleFilters(modules, selectedProject?.name, selectedDb);
  const refinedInterface = settings?.interface_layout === "refined";
  const stickyHeader = settings?.sticky_header ?? false;
  const { projectHeaderRef, projectHeaderHeight, projectTabsRef, projectTabsHeight, projectHeaderCompact } =
    useStickyProjectHeader(stickyHeader, projectViewOpen, selectedProject?.name);
  const [setModuleSelectionBanner, moduleSelectionBannerHidden] = useHiddenBelowStickyHeader(
    stickyHeader,
    projectHeaderHeight,
    projectTabsHeight,
  );

  const moduleByName = useMemo(() => new Map(modules.map((module) => [module.name, module])), [modules]);
  const installedSoclePresetIds = useMemo<Set<string>>(
    () => new Set<string>((socleCatalog?.apps ?? []).filter(socleAppInstalled).map((app) => app.id)),
    [socleCatalog],
  );
  const soclePresetsToInstall = useMemo(
    () =>
      Array.from(selectedSoclePresets)
        .filter((presetId) => !installedSoclePresetIds.has(presetId))
        .sort(),
    [selectedSoclePresets, installedSoclePresetIds],
  );
  const detectedImportedModules = useMemo(() => {
    const relevantJobs = jobs
      .filter((job) => job.project === selectedProject?.name && job.status === "done")
      .sort((left, right) => right.id - left.id);
    for (const job of relevantJobs) {
      if (job.result?.kind === "module_update") return [];
      if (job.result?.kind === "repository_modules") return job.result.modules || [];
    }
    return [];
  }, [jobs, selectedProject?.name]);
  const filteredModuleNames = useMemo(
    () => moduleFilters.filtered.map((module) => module.name),
    [moduleFilters.filtered],
  );
  const selectedFilteredModuleCount = useMemo(
    () => filteredModuleNames.filter((name) => selectedModules.has(name)).length,
    [filteredModuleNames, selectedModules],
  );
  const allFilteredModulesSelected =
    filteredModuleNames.length > 0 && selectedFilteredModuleCount === filteredModuleNames.length;

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
    [applyJobs, markApiSuccess, setSelectedJobId],
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
    [markApiSuccess],
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

  const openSettingsDialog = useCallback(() => {
    setSettingsDraft(fallbackManagerSettings(settings, overview, systemStatus));
    setSettingsOpen(true);
    setStoredRikaCredentials(null);
    window.sdkDesktop
      ?.rikaCredentials()
      .then(setStoredRikaCredentials)
      .catch(() => setStoredRikaCredentials(null));
    window.sdkDesktop
      ?.gitlabStatus()
      .then(setGitlabStatus)
      .catch(() => setGitlabStatus(null));
    void loadSettings();
    void loadSshKeys();
    void loadManagerErrors();
  }, [loadSettings, overview, settings, systemStatus]);

  // Raccourci vers les comptes : « Connecter GitLab » y mène directement.
  const openAccountSettings = useCallback(() => {
    setSettingsSection("accounts");
    openSettingsDialog();
  }, [openSettingsDialog]);

  const loadCreationPrerequisites = useCallback(async () => {
    setLoadingCreationPrerequisites(true);
    try {
      const payload = await api<ProjectCreationPrerequisites>("/api/system/project-creation-prerequisites");
      setCreationPrerequisites(payload);
      markApiSuccess();
      return payload;
    } catch (err) {
      markApiFailure(err);
      pushToast("error", err instanceof Error ? err.message : "Vérification GitLab impossible.");
      return null;
    } finally {
      setLoadingCreationPrerequisites(false);
    }
  }, [markApiFailure, markApiSuccess, pushToast]);

  const openCreateProjectDialog = useCallback(() => {
    setCreateProjectOpen(true);
    void loadCreationPrerequisites();
  }, [loadCreationPrerequisites]);

  const completeOnboarding = useCallback(async () => {
    try {
      const payload = await api<{ settings: ManagerSettings }>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ onboarding_completed: true, create_workspace: true }),
      });
      setSettings(payload.settings);
      setSettingsDraft(payload.settings);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Enregistrement impossible.");
    }
  }, [pushToast]);

  const refreshAddonLinks = useCallback(async () => {
    const projectName = selectedProject?.name;
    if (!projectName) {
      setAddonLinks(null);
      return;
    }
    try {
      const payload = await api<AddonLinksStatus>(`/api/projects/${encodeURIComponent(projectName)}/addon-links`);
      setAddonLinks(payload);
    } catch {
      // Contrôle informatif : son échec ne doit pas bloquer l'ouverture du projet.
      setAddonLinks(null);
    }
  }, [selectedProject?.name]);

  useEffect(() => {
    setAddonLinks(null);
    void refreshAddonLinks();
  }, [refreshAddonLinks]);

  const refreshModules = useCallback(async () => {
    const projectName = selectedProject?.name;
    const generation = ++modulesRequestGeneration.current;
    if (!projectName || !selectedDb || selectedDb === "postgres") {
      setModules([]);
      setLoadingModules(false);
      return;
    }
    setLoadingModules(true);
    try {
      const payload = await api<{ modules: ModuleInfo[] }>(
        `/api/projects/${encodeURIComponent(projectName)}/modules?db=${encodeURIComponent(selectedDb)}`,
      );
      if (generation !== modulesRequestGeneration.current) return;
      setModules(payload.modules);
      setSelectedModules((current) => {
        const available = new Set(payload.modules.map((module) => module.name));
        return new Set(Array.from(current).filter((name) => available.has(name)));
      });
    } catch (err) {
      if (generation !== modulesRequestGeneration.current) return;
      if (isProjectGone(err)) {
        // Projet supprimé entre-temps : pas d'erreur à montrer, la liste des projets suffit à se corriger.
        setModules([]);
        void refreshOverview();
      } else {
        pushToast("error", err instanceof Error ? err.message : "Impossible de charger les modules.");
      }
    } finally {
      if (generation === modulesRequestGeneration.current) setLoadingModules(false);
    }
  }, [pushToast, refreshOverview, selectedDb, selectedProject?.name]);

  useEffect(() => {
    const completionKey = jobs
      .filter((job) => job.project === selectedProject?.name && job.status !== "running")
      .map((job) => `${job.id}:${job.status}:${job.finished_at || ""}`)
      .join("|");
    if (!completionKey || completionKey === lastSynchronizedJobCompletion.current) return;
    lastSynchronizedJobCompletion.current = completionKey;
    void Promise.all([refreshOverview(), refreshModules(), refreshAddonLinks()]);
  }, [jobs, refreshAddonLinks, refreshModules, refreshOverview, selectedProject?.name]);

  useEffect(() => {
    setDesktopRuntime(isDesktopRuntime());
    void applicationVersion().then(setAppVersion);
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

  useEffect(() => {
    if (
      initializing ||
      onboardingPrompted.current ||
      !overview ||
      !settings ||
      settings.onboarding_completed ||
      overview.projects.length > 0
    )
      return;
    onboardingPrompted.current = true;
    setOnboardingOpen(true);
    void loadCreationPrerequisites();
  }, [initializing, loadCreationPrerequisites, overview, settings]);

  // Sous Windows, les projets servis depuis C:\ sont 10 fois plus lents que dans
  // l'environnement Linux : la préparation est proposée dès qu'elle manque.
  useEffect(() => {
    const bridge = desktopBridge();
    if (initializing || !bridge?.wslStatus) return;
    bridge
      .wslStatus()
      .then(setWslStatus)
      .catch(() => setWslStatus(null));
  }, [initializing]);

  // Le repli sur le backend Windows se décide au démarrage : l'interface dit pourquoi le poste
  // est redevenu lent, au lieu de laisser l'utilisateur le découvrir à l'usage.
  useEffect(() => {
    const bridge = desktopBridge();
    if (initializing || !bridge?.backendMode) return;
    bridge
      .backendMode()
      .then((mode) => {
        setDegradedBackendReason(mode?.degradedReason || "");
        setWslBackend(Boolean(mode?.wsl));
      })
      .catch(() => setDegradedBackendReason(""));
  }, [initializing]);

  useEffect(() => {
    if (wslSetupPrompted.current || !wslStatus || !isWslSetupPending(wslStatus, appVersion)) return;
    wslSetupPrompted.current = true;
    setWslSetupOpen(true);
  }, [appVersion, wslStatus]);

  useEffect(() => {
    if (!pendingCreatedProjectName || !overview) return;
    const created = overview.projects.find((project) => project.name === pendingCreatedProjectName);
    if (created) {
      pendingProjectNames.current.delete(pendingCreatedProjectName);
      setSelectedProjectName(created.name);
      setSelectedDb(firstOdooDatabase(created));
      setPendingCreatedProjectName("");
      return;
    }
    const job = jobs.find(
      (item) => item.project === pendingCreatedProjectName && item.title.startsWith("Créer le projet "),
    );
    if (job?.status !== "error") return;
    pendingProjectNames.current.delete(pendingCreatedProjectName);
    setSelectedProjectName((currentName) => (currentName === pendingCreatedProjectName ? "" : currentName));
    setPendingCreatedProjectName("");
  }, [jobs, overview, pendingCreatedProjectName]);

  useEffect(() => {
    if (!pendingCreatedDatabase || !overview) return;
    const job = jobs.find((item) => item.id === pendingCreatedDatabase.jobId);
    if (!job || job.status === "error") {
      if (job?.status === "error") setPendingCreatedDatabase(null);
      return;
    }
    if (job.status !== "done") return;
    const project = overview.projects.find((item) => item.name === pendingCreatedDatabase.project);
    if (!project?.databases.includes(pendingCreatedDatabase.database)) return;

    setSelectedProjectName(project.name);
    chooseDatabase(pendingCreatedDatabase.database, project.name);
    setActiveTab("modules");
    setPendingCreatedDatabase(null);
    pushToast("success", `Base ${pendingCreatedDatabase.database} prête. La liste des modules est disponible.`);
  }, [jobs, overview, pendingCreatedDatabase, pushToast]);

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
    const interval = Math.max(3, settings?.docker_poll_interval || 10) * 1000 * 3;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshSystemStatus();
    };
    const timer = window.setInterval(refreshWhenVisible, interval);
    return () => window.clearInterval(timer);
  }, [initializing, refreshSystemStatus, settings?.docker_poll_interval]);

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

  useEffect(() => {
    if (!selectedProject) return;
    const remembered = rememberedDatabases.current[selectedProject.name];
    const sameProject = databaseOwner.current === selectedProject.name;
    databaseOwner.current = selectedProject.name;
    setSelectedDb((current) =>
      databaseToKeep(selectedProject.databases, sameProject ? current : remembered || "", remembered),
    );
  }, [selectedProject]);

  useEffect(() => stopLiveLogStream, [stopLiveLogStream]);

  useEffect(() => {
    stopLiveLogStream();
  }, [selectedProject?.name, stopLiveLogStream]);

  useEffect(() => {
    refreshModules();
  }, [refreshModules]);

  async function createJob(action: string, payload: Record<string, unknown> = {}) {
    const useGlobalLoading = action !== "repository_modules";
    if (useGlobalLoading) setLoading(true);
    void requestTaskNotificationPermission().catch(() => {
      // The in-app completion toast remains available if system notifications are refused.
    });
    try {
      const result = await api<{ job: Job }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ action, ...payload }),
      });
      trackCreatedJob(result.job);
      setExternalLogView(null);
      enableLogAutoFollow();
      if (result.job.status === "queued") {
        pushToast(
          "info",
          `Action en attente : ${result.job.title}${result.job.waiting_for ? ` (${result.job.waiting_for.toLowerCase()})` : ""}. Elle démarrera automatiquement.`,
        );
      } else {
        pushToast("success", `Action lancée : ${result.job.title}`);
      }
      void refreshJobs();
      return result.job;
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Action impossible.");
      return null;
    } finally {
      if (useGlobalLoading) setLoading(false);
    }
  }

  async function loadSocleCatalog() {
    if (!selectedProject) return;
    setLoadingSocleCatalog(true);
    try {
      const params = new URLSearchParams(canUseDb ? { db: selectedDb } : {});
      setSocleCatalog(
        await api<SocleCatalog>(`/api/projects/${encodeURIComponent(selectedProject.name)}/socle?${params}`),
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible de charger le catalogue d’applications.");
    } finally {
      setLoadingSocleCatalog(false);
    }
  }

  function openSocleDialog() {
    setSelectedSoclePresets(new Set());
    setSocleSearch("");
    setSoclePlan(null);
    setSocleDialogOpen(true);
    void loadSocleCatalog();
  }

  function openRepositoryImport() {
    setRepositoryOpen(true);
  }

  function openZipImport() {
    setZipDialogOpen(true);
  }

  async function convertWslAddonLinks() {
    if (!selectedProject) return;
    const job = await createJob("convert_wsl_addon_links", { project: selectedProject.name });
    if (job) setActiveTab("logs");
  }

  async function requestDockerStart() {
    setLoading(true);
    try {
      const result = await api<{ ok: boolean; message: string }>("/api/system/docker/start", { method: "POST" });
      pushToast("info", result.message || "Démarrage de Docker demandé.");
      schedule(refreshSystemStatus, 1500);
      schedule(refreshSystemStatus, 5000);
    } catch (err) {
      if (err instanceof ApiUnavailableError && isDesktopRuntime()) {
        try {
          await openDockerDesktopNative();
          pushToast("info", "Ouverture de Docker Desktop demandée.");
          schedule(refreshSystemStatus, 3000);
          return;
        } catch (nativeError) {
          pushToast(
            "error",
            nativeError instanceof Error ? nativeError.message : "Impossible d'ouvrir Docker Desktop.",
          );
          return;
        }
      }
      pushToast("error", err instanceof Error ? err.message : "Impossible de démarrer Docker.");
    } finally {
      setLoading(false);
    }
  }

  async function openUrl(url?: string) {
    try {
      const opened = await openExternalUrl(url);
      if (!opened) pushToast("error", "Lien impossible à ouvrir depuis l'application.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Lien impossible à ouvrir depuis l'application.");
    }
  }

  async function openPostgresqlConsole() {
    const db = selectedDatabaseOrNotify("la console PostgreSQL");
    if (!db || !selectedProject || openingPostgresql) return;
    setOpeningPostgresql(true);
    try {
      const result = await api<{ ok: boolean; message: string }>(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/postgresql/open`,
        {
          method: "POST",
          body: JSON.stringify({ db }),
        },
      );
      pushToast("success", result.message || "Console PostgreSQL ouverte.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible d’ouvrir la console PostgreSQL.");
    } finally {
      setOpeningPostgresql(false);
    }
  }

  async function requestTraefikInstall() {
    if (traefikInstallRunning) return;
    if (!systemStatus?.docker.running) {
      pushToast("error", "Installe et démarre Docker avant d'installer Traefik.");
      return;
    }
    const prerequisites = creationPrerequisites || (await loadCreationPrerequisites());
    if (!prerequisites?.git_available) {
      pushToast("error", "Installe Git avant d'installer Traefik.");
      return;
    }
    const job = await createJob("install_traefik");
    if (job) {
      schedule(refreshSystemStatus, 2500);
      schedule(refreshOverview, 4000);
    }
  }

  // Les projets restés sur C:\ démarrent 10 fois plus lentement : la migration les copie
  // dans l'environnement Linux et laisse l'original intact.
  const refreshMigration = useCallback(async () => {
    try {
      setMigration(await api<MigrationSnapshot>("/api/system/migration"));
    } catch {
      setMigration(null);
    }
  }, []);

  useEffect(() => {
    if (!initializing) void refreshMigration();
  }, [initializing, refreshMigration]);

  async function requestProjectMigration(project: string, force = false) {
    const job = await createJob("migrate_project", { project, force });
    if (job) {
      schedule(refreshMigration, 3000);
      schedule(refreshOverview, 4000);
    }
  }

  /**
   * Bascule d'un clic vers l'interface affinée et l'en-tête fixe.
   *
   * La proposition est retirée dans la même requête : revenir ensuite à l'interface classique
   * depuis les paramètres est un choix, qu'elle ne doit pas venir contester.
   */
  async function switchToRefinedInterface() {
    try {
      const payload = await api<{ settings: ManagerSettings }>("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          interface_layout: "refined",
          sticky_header: true,
          beta_interface_banner_dismissed: true,
        }),
      });
      setSettings(payload.settings);
      setSettingsDraft(payload.settings);
      pushToast(
        "success",
        "Nouvelle interface activée. Retour à l’interface classique possible dans Paramètres, section Apparence.",
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible de changer d’interface.");
    }
  }

  async function dismissRefinedInterfaceProposal() {
    try {
      const payload = await api<{ settings: ManagerSettings }>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ beta_interface_banner_dismissed: true }),
      });
      setSettings(payload.settings);
      setSettingsDraft(payload.settings);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible de masquer la proposition.");
    }
  }

  /** Masque la proposition pour de bon. Seul ce réglage part : les autres sont verrouillés pendant un job. */
  async function dismissMigrationProposal() {
    try {
      const payload = await api<{ settings: ManagerSettings }>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ migration_banner_dismissed: true }),
      });
      setSettings(payload.settings);
      setSettingsDraft(payload.settings);
      await refreshMigration();
      pushToast("success", "Proposition masquée. Les projets restent copiables depuis les paramètres.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible de masquer la proposition.");
    }
  }

  // Sous WSL, le Traefik de Docker Desktop occupe le port 80 du réseau partagé de la VM.
  async function requestLegacyTraefikStop() {
    setLoading(true);
    try {
      const result = await desktopBridge()?.stopLegacyTraefik?.();
      pushToast("success", result?.message || "Ancien Traefik arrêté.");
      schedule(refreshSystemStatus, 1500);
    } catch (err) {
      pushToast("error", desktopErrorMessage(err, "Impossible d’arrêter l’ancien Traefik."));
    } finally {
      setLoading(false);
    }
  }

  // Une création interrompue laisse son dossier de préparation : 6,8 Go relevés sur un poste.
  async function requestStagingCleanup() {
    const job = await createJob("cleanup_staging");
    if (job) schedule(refreshSystemStatus, 2500);
  }

  async function loadSshKeys() {
    try {
      const payload = await api<{ keys: SshPublicKey[] }>("/api/system/ssh-keys");
      setSshKeys(payload.keys);
      setSelectedSshKeyName((current) => {
        if (payload.keys.some((key) => key.name === current)) return current;
        return payload.keys.find((key) => key.name === "id_ed25519.pub")?.name || payload.keys[0]?.name || "";
      });
      return payload.keys;
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible de lire les clés SSH.");
      return [];
    }
  }

  async function loadManagerErrors() {
    setLoadingManagerErrors(true);
    try {
      const payload = await api<{ entries: ManagerErrorEntry[]; path: string }>("/api/errors");
      setManagerErrors(payload.entries);
      setManagerErrorLogPath(payload.path);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible de charger le journal d’erreurs.");
    } finally {
      setLoadingManagerErrors(false);
    }
  }

  async function openSshAssistant(regenerate = false, provider: "gitlab" | "github" = "gitlab") {
    setSshProvider(provider);
    setSshRegenerateMode(false);
    setSshRegenerateConfirmed(false);
    setSshKeyBackup("");
    setSshDialogOpen(true);
    const keys = await loadSshKeys();
    if (regenerate && keys.length) startSshKeyRegeneration(keys);
  }

  function startSshKeyRegeneration(keys: SshPublicKey[] = sshKeys) {
    // Reprend le commentaire de la clé actuelle (souvent l'e-mail) pour identifier la nouvelle clé de la même façon.
    const current = keys.find((key) => key.name === "id_ed25519.pub") || keys[0];
    const currentComment = current?.public_key.split(/\s+/).slice(2).join(" ") || "";
    if (currentComment && !sshComment.trim()) setSshComment(currentComment);
    setSshRegenerateConfirmed(false);
    setSshRegenerateMode(true);
  }

  async function requestProjectCreation(payload: Record<string, unknown>) {
    const projectName = String(payload.name || "").trim();
    const job = await createJob("create_project", payload);
    if (!job) return false;
    pendingProjectNames.current.add(projectName);
    setPendingCreatedProjectName(projectName);
    setSelectedProjectName(projectName);
    setSelectedDb("");
    setCreateProjectOpen(false);
    setOnboardingOpen(false);
    setActiveTab("logs");
    if (!settings?.onboarding_completed) await completeOnboarding();
    schedule(refreshOverview, 2500);
    return true;
  }

  function selectedDatabaseOrNotify(action: string) {
    if (!selectedProject) {
      pushToast("error", `Sélectionne un projet avant de lancer ${action}.`);
      return "";
    }
    if (!canUseDb) {
      pushToast(
        "error",
        `Sélectionne une base Odoo avant de lancer ${action}. La base technique postgres n'est pas utilisable ici.`,
      );
      return "";
    }
    return selectedDb;
  }

  async function requestUpdateAllOdooModules() {
    const db = selectedDatabaseOrNotify("la MAJ complète Odoo");
    if (!db || !selectedProject) return;
    setAllowMissingFilestore(false);
    setUpdateFilestoreStatus(null);
    setUpdatePendingModules([]);
    setUpdateLocalExcludedModules([]);
    setMissingModulesToIgnore(new Set());
    setUpdateScope(detectedImportedModules.length ? "imported" : "all");
    setCheckingUpdatePrerequisites(true);
    try {
      const diagnostics = await api<ProjectDiagnostics>(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/diagnostics`,
      );
      const database = diagnostics.databases?.find((item) => item.name === db);
      setUpdateFilestoreStatus(database?.filestore || null);
      setUpdatePendingModules(
        database?.pending_modules ||
          (database?.pending_missing_modules || []).map((name) => ({
            name,
            state: "en attente",
            code_available: false,
          })),
      );
      setUpdateLocalExcludedModules(database?.local_excluded_modules || database?.ignored_missing_modules || []);
    } catch (err) {
      pushToast("info", err instanceof Error ? err.message : "Précontrôle du filestore indisponible.");
    } finally {
      setCheckingUpdatePrerequisites(false);
      setUpdateAllDialogOpen(true);
    }
  }

  async function refreshAllViews() {
    await Promise.all([refreshOverview(), refreshSystemStatus(), refreshJobs()]);
  }

  const handleLogOutputScroll = useCallback(() => {
    const output = logOutputRef.current;
    if (!output) return;
    const distanceFromBottom = output.scrollHeight - output.scrollTop - output.clientHeight;
    logAutoFollow.current = distanceFromBottom <= 48;
  }, []);

  function showLogs(raw = false) {
    if (!selectedProject) return;
    const projectName = selectedProject.name;
    stopLiveLogStream();
    logStreamLinesRef.current = null;
    setExternalLogView({
      title: `Logs Odoo${raw ? " (traces complètes)" : ""} - ${projectName}`,
      content: "Connexion au flux de logs en direct…",
      project: projectName,
      logs: raw ? "full" : "summary",
    });
    enableLogAutoFollow();
    if (typeof EventSource === "undefined") {
      pushToast("error", "Le suivi en direct des logs n'est pas disponible dans cet environnement.");
      return;
    }
    const source = new EventSource(
      `${API_BASE}/api/projects/${encodeURIComponent(projectName)}/logs/stream${raw ? "?raw=1" : ""}`,
    );
    logStreamRef.current = source;
    const renderLines = () => {
      if (logStreamRef.current !== source || !logStreamLinesRef.current) return;
      const content = logStreamLinesRef.current.join("\n");
      setExternalLogView((current) => (current && current.project === projectName ? { ...current, content } : current));
    };
    source.addEventListener("log", (event) => {
      let line = "";
      try {
        line = (JSON.parse((event as MessageEvent<string>).data) as { line?: string }).line || "";
      } catch {
        return;
      }
      const lines = logStreamLinesRef.current ?? [];
      lines.push(line);
      if (lines.length > LIVE_LOG_MAX_LINES) lines.splice(0, lines.length - LIVE_LOG_MAX_LINES);
      logStreamLinesRef.current = lines;
      // Une rafale de lignes ne redessine la sortie qu'une fois par image.
      if (logStreamFrameRef.current !== null) return;
      logStreamFrameRef.current = window.requestAnimationFrame(() => {
        logStreamFrameRef.current = null;
        renderLines();
      });
    });
    source.addEventListener("log_end", () => {
      if (logStreamRef.current !== source) return;
      // Les dernières lignes attendaient peut-être l'image suivante : elles s'affichent avant l'arrêt.
      renderLines();
      stopLiveLogStream();
    });
    source.onerror = () => {
      if (logStreamRef.current === source) pushToast("error", "Flux de logs interrompu, nouvelle tentative en cours…");
    };
  }

  /** Ouvre le suivi d'une action : son projet, puis l'onglet Activité sur cette action. */
  function followJob(job: Job) {
    if (job.project) {
      setSelectedProjectName(job.project);
      setSelectedDb((currentDb) => currentDb || "postgres");
    }
    selectJob(job.id);
    setActiveTab("logs");
  }

  function selectJob(jobId: number) {
    stopLiveLogStream();
    setExternalLogView(null);
    setRawOutputVisible(false);
    enableLogAutoFollow();
    focusJob(jobId);
  }

  function requestUninstall(moduleNames: string[]) {
    const installed = moduleNames.filter(
      (name) => modules.find((module) => module.name === name)?.state === "installed",
    );
    if (!installed.length) {
      pushToast("error", "Sélectionne au moins un module installé.");
      return;
    }
    setPendingUninstallModules(installed);
    setUninstallDialogOpen(true);
  }

  function requestTranslationReset(moduleNames: string[]) {
    const installed = moduleNames.filter(
      (name) => modules.find((module) => module.name === name)?.state === "installed",
    );
    if (!installed.length) {
      pushToast("error", "Sélectionne au moins un module installé.");
      return;
    }
    setPendingTranslationResetModules(installed);
  }

  async function openAllTranslationsReset() {
    const db = selectedDatabaseOrNotify("la réinitialisation des traductions");
    if (!db || !selectedProject) return;
    setTranslationLanguages(null);
    setSelectedTranslationLanguages(new Set());
    setAllTranslationsOpen(true);
    try {
      const params = new URLSearchParams({ db });
      const result = await api<{ languages: { code: string; name: string }[] }>(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/languages?${params}`,
      );
      setTranslationLanguages(result.languages);
      setSelectedTranslationLanguages(new Set(result.languages.map((language) => language.code)));
    } catch (err) {
      setTranslationLanguages([]);
      pushToast("error", err instanceof Error ? err.message : "Impossible de lire les langues installées.");
    }
  }

  /** Choix explicite d'une base : affiché tout de suite et retenu pour ce projet pendant la session. */
  function chooseDatabase(db: string, projectName = selectedProject?.name) {
    setSelectedDb(db);
    if (!projectName || !db || db === "postgres") return;
    if (projectName === selectedProject?.name) databaseOwner.current = projectName;
    rememberedDatabases.current = { ...rememberedDatabases.current, [projectName]: db };
    writeRememberedDatabases(rememberedDatabases.current);
  }

  // Base en cours de suppression : une fois l'action réussie, elle est oubliée. Une liste vide
  // conserve sinon la sélection (sonde Postgres lente) et pointerait vers une base disparue.
  const droppedDatabase = useRef<{ jobId: number; project: string; db: string } | null>(null);
  useEffect(() => {
    const dropped = droppedDatabase.current;
    if (!dropped) return;
    const job = jobs.find((item) => item.id === dropped.jobId);
    if (!job || isJobActive(job)) return;
    droppedDatabase.current = null;
    if (job.status !== "done") return;
    if (rememberedDatabases.current[dropped.project] === dropped.db) {
      const { [dropped.project]: _forgotten, ...others } = rememberedDatabases.current;
      rememberedDatabases.current = others;
      writeRememberedDatabases(others);
    }
    if (selectedProject?.name === dropped.project) setSelectedDb((current) => (current === dropped.db ? "" : current));
  }, [jobs, selectedProject?.name]);

  function executeDatabaseAction(action: DatabaseMenuAction) {
    if (action === "regenerate_assets") void regenerateOdooAssets();
    else if (action === "reset_translations") void openAllTranslationsReset();
    else if (action === "neutralize") setNeutralizeDbOpen(true);
    else if (action === "admin_password") setAdminPasswordOpen(true);
    else if (action === "psql") void openPostgresqlConsole();
    else if (action === "drop") setDropDbOpen(true);
  }

  async function regenerateOdooAssets() {
    const db = selectedDatabaseOrNotify("la régénération des assets");
    if (!db || !selectedProject) return;
    await createJob("regenerate_assets", { project: selectedProject.name, db });
  }

  function requestDeleteCode(moduleNames: string[]) {
    const removable = moduleNames.filter((name) => {
      const moduleInfo = modules.find((candidate) => candidate.name === name);
      return moduleInfo?.removable && moduleInfo.removal_mode !== "link_only";
    });
    if (!removable.length) {
      pushToast("error", "Sélectionne au moins un module supprimable du dossier addons.");
      return;
    }
    if (removable.length < moduleNames.length) {
      pushToast("info", "Certains modules protégés ont été ignorés.");
    }
    setPendingDeleteCodeModules(removable);
    setDeleteCodeUninstallFirst(Boolean(canUseDb));
    setDeleteCodeDialogOpen(true);
  }

  async function restoreDatabaseBackup(payload: RestoreDatabasePayload, onProgress: (progress: number) => void) {
    setLoading(true);
    void requestTaskNotificationPermission().catch(() => {
      // The in-app completion toast remains available if system notifications are refused.
    });
    try {
      const result = await uploadDatabaseBackup(payload, onProgress);
      trackCreatedJob(result.job);
      setExternalLogView(null);
      enableLogAutoFollow();
      setRestoreDbOpen(false);
      pushToast("success", `Restauration lancée : ${payload.db}`);
      await refreshJobs();
      schedule(refreshOverview, 2500);
      return true;
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Restauration impossible.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  const selectedModuleList = useMemo(() => Array.from(selectedModules), [selectedModules]);
  const selectedInstalledModuleList = useMemo(
    () => selectedModuleList.filter((name) => moduleByName.get(name)?.state === "installed"),
    [moduleByName, selectedModuleList],
  );
  const selectedInstallableModuleList = useMemo(
    () => selectedModuleList.filter((name) => moduleByName.get(name)?.state !== "installed"),
    [moduleByName, selectedModuleList],
  );
  const selectedRemovableModuleList = useMemo(
    () =>
      selectedModuleList.filter((name) => {
        const moduleInfo = moduleByName.get(name);
        return moduleInfo?.removable && moduleInfo.removal_mode !== "link_only";
      }),
    [moduleByName, selectedModuleList],
  );
  const selectedProjectReady = Boolean(selectedProject);
  const selectedProjectOnline = selectedProject?.odoo_status === "running";
  // Projet démarré sans aucune base : seuls les onglets Bases et Réglages ont un sens, et la
  // création de base devient l'étape recommandée. `selectedDb` reste renseigné pendant une sonde
  // Postgres momentanément vide : il évite de masquer les onglets d'un projet qui a des bases.
  const awaitingFirstDatabase = selectedProjectOnline && odooDatabases.length === 0 && !selectedDb;
  const projectTabVisible: Record<string, boolean> = {
    bases: selectedProjectOnline,
    modules: selectedProjectOnline && !awaitingFirstDatabase,
    // Projet arrêté : l'activité reste visible, elle explique souvent pourquoi il ne démarre pas.
    logs: !awaitingFirstDatabase,
    actions: true,
  };

  // Un onglet masqué ne reste jamais actif.
  useEffect(() => {
    if (awaitingFirstDatabase && (activeTab === "modules" || activeTab === "logs")) setActiveTab("bases");
  }, [activeTab, awaitingFirstDatabase]);
  // Sans projet ouvert, les onglets n'offrent que des panneaux vides : l'accueil prend la place.
  const showWelcome = !projectViewOpen;

  useEffect(() => {
    if (showWelcome || !selectedProject || selectedProjectOnline) return;
    function backToWelcomeOnEscape(event: KeyboardEvent) {
      // Une fenêtre ou un menu Radix consomme déjà Échap ; un champ de saisie le garde pour lui.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      // Échap sert d'abord à vider la sélection de modules.
      if (selectedModules.size > 0) return;
      setSelectedProjectName("");
      setSelectedDb("");
      // Le bouton du projet garderait sinon son anneau de focus, sans être sélectionné.
      (document.activeElement as HTMLElement | null)?.blur();
    }
    window.addEventListener("keydown", backToWelcomeOnEscape);
    return () => window.removeEventListener("keydown", backToWelcomeOnEscape);
  }, [selectedModules, selectedProject, selectedProjectOnline, showWelcome]);
  const canUseDb = Boolean(selectedDb && odooDatabases.includes(selectedDb));

  useEffect(() => {
    if (!pendingDatabaseAction || pendingDatabaseAction.db !== selectedDb) return;
    setPendingDatabaseAction(null);
    executeDatabaseAction(pendingDatabaseAction.action);
    // executeDatabaseAction est recréée à chaque rendu et lit la sélection courante.
  }, [pendingDatabaseAction, selectedDb]);
  const repositoryInspectionKey =
    repositoryOpen && repositoryUrl.trim() && !repositoryUrlError && repositoryBranch.trim()
      ? `${selectedProject?.name || ""}|${repositoryUrl.trim()}|${repositoryBranch.trim()}`
      : "";
  const soclePlanKey = socleDialogOpen && canUseDb ? soclePresetsToInstall.join(",") : "";
  const scopedExternalLogView = externalLogView?.project === selectedProject?.name ? externalLogView : null;
  const outputContent =
    scopedExternalLogView?.content || selectedJob?.output || selectedJob?.lines?.join("\n") || "Aucune sortie.";
  const outputSource = scopedExternalLogView
    ? `external:${scopedExternalLogView.title}`
    : `job:${selectedJob?.id || "none"}`;

  useEffect(() => {
    setLogDescriptionExpanded(false);
  }, [outputSource]);

  useEffect(() => {
    if (rawOutputVisible) enableLogAutoFollow();
  }, [rawOutputVisible, enableLogAutoFollow]);

  // Un job suivi en direct garde sa sortie affichée quand il se termine, au lieu de se replier sous l'utilisateur.
  useEffect(() => {
    const previous = previousSelectedJobRef.current;
    const current = { id: selectedJob?.id ?? null, status: selectedJob?.status ?? null };
    if (
      previous.id === current.id &&
      previous.status &&
      isJobUnfinished({ status: previous.status }) &&
      current.status &&
      !isJobUnfinished({ status: current.status })
    ) {
      setRawOutputVisible(true);
    }
    previousSelectedJobRef.current = current;
  }, [selectedJob?.id, selectedJob?.status]);

  useEffect(() => {
    if (activeTab !== "logs") return;
    if (lastLogOutputSource.current !== outputSource) {
      lastLogOutputSource.current = outputSource;
      logAutoFollow.current = true;
    }
    if (logAutoFollow.current) scrollLogOutputToBottom();
  }, [activeTab, outputContent, outputSource, scrollLogOutputToBottom]);

  useEffect(() => {
    if (!selectedProjectOnline && (activeTab === "bases" || activeTab === "modules")) {
      setActiveTab("logs");
    }
  }, [activeTab, selectedProjectOnline]);

  const hasModuleSelection = selectedModules.size > 0;
  useEffect(() => {
    if (activeTab !== "modules" || !hasModuleSelection) return;
    function clearSelectionOnEscape(event: KeyboardEvent) {
      // Une fenêtre ou un menu Radix consomme déjà Échap ; un champ de saisie le garde pour lui.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      setSelectedModules(new Set());
    }
    window.addEventListener("keydown", clearSelectionOnEscape);
    return () => window.removeEventListener("keydown", clearSelectionOnEscape);
  }, [activeTab, hasModuleSelection]);

  const toggleFilteredModules = useCallback(
    (checked: boolean) => {
      setSelectedModules((current) => {
        const next = new Set(current);
        for (const name of filteredModuleNames) {
          if (checked) next.add(name);
          else next.delete(name);
        }
        return next;
      });
    },
    [filteredModuleNames],
  );

  if (initializing) {
    return (
      <LoadingScreen
        appIcon={selectedAppIcon}
        roundIcon={settings?.interface_icon === "local"}
        message={initializationMessage}
        error={initializationError}
        diagnostics={backendDiagnostics}
        onRetry={initializeApplication}
      />
    );
  }

  const moduleSelectionBarProps = {
    selectedCount: selectedModuleList.length,
    installableModules: selectedInstallableModuleList,
    installedModules: selectedInstalledModuleList,
    removableModules: selectedRemovableModuleList,
    filteredCount: filteredModuleNames.length,
    allFilteredSelected: allFilteredModulesSelected,
    busy: !canUseDb || loading,
    loading,
    onSelectAllFiltered: () => toggleFilteredModules(true),
    onClearSelection: () => setSelectedModules(new Set()),
    onInstall: (names: string[]) =>
      void createJob("install_module", { project: selectedProject?.name, db: selectedDb, modules: names.join(",") }),
    onUpdate: (names: string[]) =>
      void createJob("update_module", { project: selectedProject?.name, db: selectedDb, modules: names.join(",") }),
    onUninstall: requestUninstall,
    onResetTranslations: requestTranslationReset,
    onDeleteCode: requestDeleteCode,
  } satisfies ModuleSelectionBarProps;

  const showFloatingModuleActions =
    activeTab === "modules" && selectedModuleList.length > 0 && moduleSelectionBannerHidden;

  // Le ref suit la barre en place : quand elle sort de l'écran, sa copie flottante prend le relais.
  const moduleSelectionBlock = (
    <div ref={setModuleSelectionBanner}>
      <ModuleSelectionBar {...moduleSelectionBarProps} />
    </div>
  );

  return (
    <main className="sdk-shell min-h-screen overflow-x-clip">
      <div className="flex min-h-screen min-w-0 flex-col lg:flex-row">
        <AppSidebar
          jobs={jobs}
          openCreateProjectDialog={openCreateProjectDialog}
          openSettingsDialog={openSettingsDialog}
          overview={overview}
          pendingProjectArrivals={pendingProjectArrivals}
          selectedAppIcon={selectedAppIcon}
          selectedProject={selectedProject}
          selectedProjectName={selectedProjectName}
          selectJob={selectJob}
          setAboutOpen={setAboutOpen}
          setActiveTab={setActiveTab}
          setExternalLogView={setExternalLogView}
          setSelectedDb={setSelectedDb}
          setSelectedProjectName={setSelectedProjectName}
          settings={settings}
          systemStatus={systemStatus}
        />

        {/* overflow-x-clip borne le bandeau pleine largeur des onglets sans casser les éléments collés. */}
        <section className="min-w-0 flex-1 overflow-x-clip">
          {/* Sans projet ouvert, l'en-tête et les onglets laissent la place à l'accueil. */}
          {!showWelcome && (
            <ProjectHeader
              createJob={createJob}
              jobs={jobs}
              loading={loading}
              openingOdoo={openingOdoo}
              pendingSelectedProjectArrival={pendingSelectedProjectArrival}
              projectHeaderCompact={projectHeaderCompact}
              projectHeaderRef={projectHeaderRef}
              pushToast={pushToast}
              refreshAllViews={refreshAllViews}
              refreshOverview={refreshOverview}
              refreshSystemStatus={refreshSystemStatus}
              schedule={schedule}
              selectedDb={selectedDb}
              selectedProject={selectedProject}
              selectedProjectOnline={selectedProjectOnline}
              selectedProjectReady={selectedProjectReady}
              setOpeningOdoo={setOpeningOdoo}
              stickyHeader={stickyHeader}
            />
          )}

          <div className={cn("mx-auto max-w-[1500px] px-4 py-4", showFloatingModuleActions && "pb-32 xl:pb-24")}>
            {apiUnavailable && (
              <ApiUnavailableNotice
                desktopRuntime={desktopRuntime}
                loadSettings={loadSettings}
                openUrl={openUrl}
                refreshOverview={refreshOverview}
                refreshSystemStatus={refreshSystemStatus}
                requestDockerStart={requestDockerStart}
              />
            )}
            {degradedBackendReason && (
              <DegradedBackendNotice degradedBackendReason={degradedBackendReason} openUrl={openUrl} />
            )}
            {systemStatus && !systemStatus.docker.running && (
              <DockerNotice
                loading={loading}
                openSettingsDialog={openSettingsDialog}
                openUrl={openUrl}
                requestDockerStart={requestDockerStart}
                docker={systemStatus.docker}
              />
            )}
            {systemStatus?.traefik && !systemStatus.traefik.running && (
              <TraefikNotice
                loading={loading}
                openSettingsDialog={openSettingsDialog}
                requestLegacyTraefikStop={requestLegacyTraefikStop}
                requestTraefikInstall={requestTraefikInstall}
                traefik={systemStatus.traefik}
                dockerRunning={systemStatus.docker.running}
              />
            )}
            {migrationBannerVisible && (
              <MigrationNotice
                dismissMigrationProposal={dismissMigrationProposal}
                loading={loading}
                migration={migration}
                migrationCandidates={migrationCandidates}
                requestProjectMigration={requestProjectMigration}
                setMigrationBannerClosed={setMigrationBannerClosed}
              />
            )}
            {(systemStatus?.abandoned_staging?.count ?? 0) > 0 && (
              <StagingCleanupNotice
                loading={loading}
                requestStagingCleanup={requestStagingCleanup}
                count={systemStatus!.abandoned_staging!.count}
              />
            )}
            {selectedProject && addonLinks?.supported && (addonLinks.wsl_links > 0 || addonLinks.interrupted) && (
              <AddonLinksNotice
                addonLinks={addonLinks}
                convertWslAddonLinks={convertWslAddonLinks}
                loading={loading}
                refreshAddonLinks={refreshAddonLinks}
                selectedProjectOnline={selectedProjectOnline}
              />
            )}
            {error && (
              <Notice tone="danger" icon={AlertTriangle} title="L’action a échoué">
                {error}
              </Notice>
            )}
            {settings?.interface_layout === "classic" && !settings.beta_interface_banner_dismissed && (
              <RefinedInterfaceNotice
                dismissRefinedInterfaceProposal={dismissRefinedInterfaceProposal}
                switchToRefinedInterface={switchToRefinedInterface}
              />
            )}
            {runningJobs.length > 0 && <RunningJobsBanner onFollowJob={followJob} runningJobs={runningJobs} />}

            {showWelcome ? (
              <WelcomeScreen
                icon={selectedAppIcon}
                hasProjects={Boolean(overview?.projects.length)}
                docker={{
                  ready: Boolean(systemStatus?.docker.running),
                  message: systemStatus?.docker.message || "Vérification en cours…",
                }}
                traefik={
                  systemStatus?.traefik
                    ? { ready: systemStatus.traefik.running, message: systemStatus.traefik.message }
                    : null
                }
                onCreateProject={openCreateProjectDialog}
                onOpenSettings={openSettingsDialog}
                onRefresh={refreshAllViews}
              />
            ) : (
              <Tabs
                value={activeTab}
                onValueChange={(value) => {
                  if (value === "logs") enableLogAutoFollow();
                  setActiveTab(value);
                }}
              >
                <div
                  ref={projectTabsRef}
                  className={cn(
                    // Fond transparent au repos : le bandeau apparaît en fondu, au rythme du défilement, sur toute la largeur de la zone.
                    // Réservé à Modules : les autres onglets ont leur propre défilement et n'ont pas été conçus pour un en-tête collant.
                    stickyHeader &&
                      activeTab === "modules" &&
                      "-my-2 py-2 lg:sticky lg:z-20 lg:before:pointer-events-none lg:before:absolute lg:before:inset-y-0 lg:before:-inset-x-[100vw] lg:before:-z-10 lg:before:border-b lg:before:bg-background/90 lg:before:opacity-[var(--tabs-backdrop,0)] lg:before:backdrop-blur lg:before:transition-opacity lg:before:duration-300 lg:before:ease-out motion-reduce:lg:before:transition-none",
                  )}
                  style={stickyHeader && activeTab === "modules" ? { top: projectHeaderHeight } : undefined}
                >
                  <TabsList
                    className="grid w-full overflow-hidden transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none lg:w-fit"
                    style={{
                      gridTemplateColumns: ["bases", "modules", "logs", "actions"]
                        .map((tab) => (projectTabVisible[tab] ? "minmax(0,1fr)" : "minmax(0,0fr)"))
                        .join(" "),
                    }}
                  >
                    <TabsTrigger
                      value="bases"
                      disabled={!projectTabVisible.bases}
                      className={cn(
                        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                        !projectTabVisible.bases && "pointer-events-none -translate-x-1 opacity-0",
                      )}
                    >
                      <Database className="mr-1.5 h-4 w-4" />
                      Bases
                    </TabsTrigger>
                    <TabsTrigger
                      value="modules"
                      disabled={!projectTabVisible.modules}
                      className={cn(
                        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                        !projectTabVisible.modules && "pointer-events-none -translate-x-1 opacity-0",
                      )}
                    >
                      <Boxes className="mr-1.5 h-4 w-4" />
                      Modules
                    </TabsTrigger>
                    <TabsTrigger
                      value="logs"
                      disabled={!projectTabVisible.logs}
                      className={cn(
                        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                        !projectTabVisible.logs && "pointer-events-none -translate-x-1 opacity-0",
                      )}
                    >
                      <Logs className="mr-1.5 h-4 w-4" />
                      {refinedInterface ? "Activité" : "Logs"}
                    </TabsTrigger>
                    <TabsTrigger value="actions">
                      <Settings className="mr-1.5 h-4 w-4" />
                      {refinedInterface ? "Réglages" : "Actions"}
                    </TabsTrigger>
                  </TabsList>
                </div>

                {selectedProjectOnline && (
                  <DatabasesTab
                    canUseDb={canUseDb}
                    chooseDatabase={chooseDatabase}
                    executeDatabaseAction={executeDatabaseAction}
                    loading={loading}
                    odooDatabases={odooDatabases}
                    openAllTranslationsReset={openAllTranslationsReset}
                    openingPostgresql={openingPostgresql}
                    openPostgresqlConsole={openPostgresqlConsole}
                    openUrl={openUrl}
                    postgresDetailsOpen={postgresDetailsOpen}
                    refinedInterface={refinedInterface}
                    regenerateOdooAssets={regenerateOdooAssets}
                    selectedDb={selectedDb}
                    selectedProject={selectedProject}
                    selectedProjectReady={selectedProjectReady}
                    setAdminPasswordOpen={setAdminPasswordOpen}
                    setCreateDbOpen={setCreateDbOpen}
                    setDropDbOpen={setDropDbOpen}
                    setNeutralizeDbOpen={setNeutralizeDbOpen}
                    setPendingDatabaseAction={setPendingDatabaseAction}
                    setPostgresDetailsOpen={setPostgresDetailsOpen}
                    setRestoreDbOpen={setRestoreDbOpen}
                  />
                )}

                {selectedProjectOnline && (
                  <ModulesTab
                    canUseDb={canUseDb}
                    checkingUpdatePrerequisites={checkingUpdatePrerequisites}
                    chooseDatabase={chooseDatabase}
                    createJob={createJob}
                    loading={loading}
                    loadingModules={loadingModules}
                    moduleFilters={moduleFilters}
                    modules={modules}
                    moduleSelectionBlock={moduleSelectionBlock}
                    odooDatabases={odooDatabases}
                    openRepositoryImport={openRepositoryImport}
                    openSocleDialog={openSocleDialog}
                    openZipImport={openZipImport}
                    overview={overview}
                    projectHeaderHeight={projectHeaderHeight}
                    projectTabsHeight={projectTabsHeight}
                    refinedInterface={refinedInterface}
                    refreshModules={refreshModules}
                    requestDeleteCode={requestDeleteCode}
                    requestTranslationReset={requestTranslationReset}
                    requestUninstall={requestUninstall}
                    requestUpdateAllOdooModules={requestUpdateAllOdooModules}
                    selectedDb={selectedDb}
                    selectedModules={selectedModules}
                    selectedProject={selectedProject}
                    selectedProjectReady={selectedProjectReady}
                    setSelectedModules={setSelectedModules}
                    settings={settings}
                    stickyHeader={stickyHeader}
                  />
                )}

                <ActivityTab
                  enableLogAutoFollow={enableLogAutoFollow}
                  logDescriptionExpanded={logDescriptionExpanded}
                  logOutputRef={logOutputRef}
                  onLogOutputScroll={handleLogOutputScroll}
                  onShowLogs={showLogs}
                  outputContent={outputContent}
                  projectJobs={projectJobs}
                  pushToast={pushToast}
                  rawOutputVisible={rawOutputVisible}
                  refinedInterface={refinedInterface}
                  refreshJobs={refreshJobs}
                  scopedExternalLogView={scopedExternalLogView}
                  selectedJob={selectedJob}
                  selectedJobId={selectedJobId}
                  selectedProject={selectedProject}
                  selectedProjectReady={selectedProjectReady}
                  selectJob={selectJob}
                  setExternalLogView={setExternalLogView}
                  setJobToCancelId={setJobToCancelId}
                  setLogDescriptionExpanded={setLogDescriptionExpanded}
                  setRawOutputVisible={setRawOutputVisible}
                  setSelectedJobId={setSelectedJobId}
                  stopLiveLogStream={stopLiveLogStream}
                />

                <ProjectSettingsTab
                  createJob={createJob}
                  openUrl={openUrl}
                  refinedInterface={refinedInterface}
                  selectedProject={selectedProject}
                  selectedProjectReady={selectedProjectReady}
                  setDeleteDialogOpen={setDeleteDialogOpen}
                  settings={settings}
                />
              </Tabs>
            )}
          </div>
        </section>
      </div>

      <WslSetupDialog
        open={wslSetupOpen}
        onOpenChange={setWslSetupOpen}
        applicationVersion={appVersion}
        onReady={() => {
          setWslSetupOpen(false);
          // Le backend en service est encore celui de Windows : l'application redémarre sur
          // l'environnement Linux, sauf si une action tourne, qu'un redémarrage interromprait.
          if (hasRunningJobs) {
            pushToast(
              "success",
              "Environnement Linux prêt. Redémarre l’application une fois les actions en cours terminées.",
            );
            return;
          }
          pushToast("success", "Environnement Linux prêt. Redémarrage de l’application…");
          window.setTimeout(() => void desktopBridge()?.relaunch?.(), 1500);
        }}
      />

      <OnboardingDialog
        completeOnboarding={completeOnboarding}
        createJob={createJob}
        creationPrerequisites={creationPrerequisites}
        jobs={jobs}
        loadCreationPrerequisites={loadCreationPrerequisites}
        loading={loading}
        loadingCreationPrerequisites={loadingCreationPrerequisites}
        onOpenChange={setOnboardingOpen}
        open={onboardingOpen}
        openCreateProjectDialog={openCreateProjectDialog}
        openSshAssistant={openSshAssistant}
        overview={overview}
        pushToast={pushToast}
        requestDockerStart={requestDockerStart}
        requestTraefikInstall={requestTraefikInstall}
        schedule={schedule}
        systemStatus={systemStatus}
        traefikInstallRunning={traefikInstallRunning}
      />

      <SshKeyDialog
        creationPrerequisites={creationPrerequisites}
        provider={sshProvider}
        loadCreationPrerequisites={loadCreationPrerequisites}
        loadSshKeys={loadSshKeys}
        onOpenChange={setSshDialogOpen}
        open={sshDialogOpen}
        openUrl={openUrl}
        pushToast={pushToast}
        selectedSshKey={selectedSshKey}
        selectedSshKeyName={selectedSshKeyName}
        setSelectedSshKeyName={setSelectedSshKeyName}
        setSshComment={setSshComment}
        setSshKeyBackup={setSshKeyBackup}
        setSshRegenerateConfirmed={setSshRegenerateConfirmed}
        setSshRegenerateMode={setSshRegenerateMode}
        sshComment={sshComment}
        sshKeyBackup={sshKeyBackup}
        sshKeys={sshKeys}
        sshRegenerateConfirmed={sshRegenerateConfirmed}
        sshRegenerateMode={sshRegenerateMode}
        startSshKeyRegeneration={startSshKeyRegeneration}
      />

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        prerequisites={creationPrerequisites}
        dockerReady={Boolean(systemStatus?.docker.running)}
        loading={loading}
        onRefreshPrerequisites={loadCreationPrerequisites}
        onSubmit={requestProjectCreation}
        onManageGitlab={() => {
          setCreateProjectOpen(false);
          openAccountSettings();
        }}
      />

      <SettingsDialog
        desktopRuntime={desktopRuntime}
        gitlabStatus={gitlabStatus}
        loadCreationPrerequisites={loadCreationPrerequisites}
        loading={loading}
        loadingManagerErrors={loadingManagerErrors}
        loadManagerErrors={loadManagerErrors}
        managerErrorLogPath={managerErrorLogPath}
        managerErrors={managerErrors}
        migration={migration}
        migrationCandidates={migrationCandidates}
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
        openSshAssistant={openSshAssistant}
        pushToast={pushToast}
        refreshMigration={refreshMigration}
        refreshOverview={refreshOverview}
        refreshSystemStatus={refreshSystemStatus}
        requestProjectMigration={requestProjectMigration}
        selectedSshKey={selectedSshKey}
        setGitlabStatus={setGitlabStatus}
        setManagerErrors={setManagerErrors}
        setMigrationBannerClosed={setMigrationBannerClosed}
        setModules={setModules}
        setOnboardingOpen={setOnboardingOpen}
        setSelectedDb={setSelectedDb}
        setSelectedProjectName={setSelectedProjectName}
        setSettings={setSettings}
        setSettingsDraft={setSettingsDraft}
        setSettingsSection={setSettingsSection}
        setStoredRikaCredentials={setStoredRikaCredentials}
        settings={settings}
        settingsDraft={settingsDraft}
        settingsSection={settingsSection}
        storedRikaCredentials={storedRikaCredentials}
        systemStatus={systemStatus}
        wslBackend={wslBackend}
      />

      <AboutDialog
        appVersion={appVersion}
        onOpenChange={setAboutOpen}
        open={aboutOpen}
        pushToast={pushToast}
        selectedAppIcon={selectedAppIcon}
        settings={settings}
      />

      <SocleDialog
        createJob={createJob}
        loading={loading}
        loadingSocleCatalog={loadingSocleCatalog}
        onOpenChange={setSocleDialogOpen}
        open={socleDialogOpen}
        refreshModules={refreshModules}
        schedule={schedule}
        selectedDb={selectedDb}
        selectedProject={selectedProject}
        selectedSoclePresets={selectedSoclePresets}
        setActiveTab={setActiveTab}
        setSelectedSoclePresets={setSelectedSoclePresets}
        setSoclePlan={setSoclePlan}
        setSocleSearch={setSocleSearch}
        socleCatalog={socleCatalog}
        soclePlan={soclePlan}
        soclePlanKey={soclePlanKey}
        soclePresetsToInstall={soclePresetsToInstall}
        socleSearch={socleSearch}
      />

      <RepositoryImportDialog
        canUseDb={canUseDb}
        createJob={createJob}
        gitlabStatus={gitlabStatus}
        onOpenChange={setRepositoryOpen}
        open={repositoryOpen}
        openAccountSettings={openAccountSettings}
        openSshAssistant={openSshAssistant}
        repositoryBranch={repositoryBranch}
        repositoryInspectionKey={repositoryInspectionKey}
        repositoryUrl={repositoryUrl}
        repositoryUrlError={repositoryUrlError}
        selectedDb={selectedDb}
        selectedProject={selectedProject}
        selectedProjectReady={selectedProjectReady}
        setActiveTab={setActiveTab}
        setGitlabStatus={setGitlabStatus}
        setRepositoryBranch={setRepositoryBranch}
        setRepositoryUrl={setRepositoryUrl}
      />

      <ZipImportDialog
        loading={loading}
        onOpenChange={setZipDialogOpen}
        open={zipDialogOpen}
        pushToast={pushToast}
        refreshJobs={refreshJobs}
        refreshModules={refreshModules}
        schedule={schedule}
        selectedProject={selectedProject}
        setExternalLogView={setExternalLogView}
        setLoading={setLoading}
        setSelectedJobId={setSelectedJobId}
      />

      <CreateDatabaseDialog
        open={createDbOpen}
        onOpenChange={setCreateDbOpen}
        project={selectedProject}
        onSubmit={async (payload) => {
          const job = await createJob("create_database", payload);
          if (job) {
            setPendingCreatedDatabase({
              jobId: job.id,
              project: String(payload.project || ""),
              database: String(payload.db || "").trim(),
            });
            setCreateDbOpen(false);
            setActiveTab("logs");
          }
        }}
      />

      <RestoreDatabaseDialog
        open={restoreDbOpen}
        onOpenChange={setRestoreDbOpen}
        project={selectedProject}
        onSubmit={restoreDatabaseBackup}
      />

      <NeutralizeDatabaseDialog
        canUseDb={canUseDb}
        createJob={createJob}
        loading={loading}
        onOpenChange={setNeutralizeDbOpen}
        open={neutralizeDbOpen}
        selectedDb={selectedDb}
        selectedProject={selectedProject}
      />

      <DropDatabaseDialog
        open={dropDbOpen}
        onOpenChange={setDropDbOpen}
        project={selectedProject}
        database={selectedDb}
        disabled={!canUseDb || loading}
        onSubmit={async (masterPwd) => {
          const job = await createJob("drop_database", {
            project: selectedProject?.name,
            db: selectedDb,
            master_pwd: masterPwd,
          });
          if (job && selectedProject)
            droppedDatabase.current = { jobId: job.id, project: selectedProject.name, db: selectedDb };
          if (job) setDropDbOpen(false);
        }}
      />

      <DeleteProjectDialog
        createJob={createJob}
        onOpenChange={setDeleteDialogOpen}
        open={deleteDialogOpen}
        selectedProject={selectedProject}
      />

      <UpdateAllModulesDialog
        allowMissingFilestore={allowMissingFilestore}
        applyJobs={applyJobs}
        canUseDb={canUseDb}
        checkingUpdatePrerequisites={checkingUpdatePrerequisites}
        createJob={createJob}
        detectedImportedModules={detectedImportedModules}
        loading={loading}
        missingModulesToIgnore={missingModulesToIgnore}
        onOpenChange={setUpdateAllDialogOpen}
        open={updateAllDialogOpen}
        pushToast={pushToast}
        refreshModules={refreshModules}
        requestUpdateAllOdooModules={requestUpdateAllOdooModules}
        schedule={schedule}
        selectedDatabaseOrNotify={selectedDatabaseOrNotify}
        selectedDb={selectedDb}
        selectedProject={selectedProject}
        selectedProjectReady={selectedProjectReady}
        setActiveTab={setActiveTab}
        setAllowMissingFilestore={setAllowMissingFilestore}
        setMissingModulesToIgnore={setMissingModulesToIgnore}
        setUpdateFilestoreStatus={setUpdateFilestoreStatus}
        setUpdateLocalExcludedModules={setUpdateLocalExcludedModules}
        setUpdatePendingModules={setUpdatePendingModules}
        setUpdateScope={setUpdateScope}
        updateFilestoreStatus={updateFilestoreStatus}
        updateLocalExcludedModules={updateLocalExcludedModules}
        updatePendingModules={updatePendingModules}
        updateScope={updateScope}
      />

      <TranslationResetDialog
        canUseDb={canUseDb}
        createJob={createJob}
        loading={loading}
        pendingTranslationResetModules={pendingTranslationResetModules}
        selectedDatabaseOrNotify={selectedDatabaseOrNotify}
        selectedDb={selectedDb}
        selectedProject={selectedProject}
        setPendingTranslationResetModules={setPendingTranslationResetModules}
      />

      <AllTranslationsResetDialog
        canUseDb={canUseDb}
        createJob={createJob}
        loading={loading}
        onOpenChange={setAllTranslationsOpen}
        open={allTranslationsOpen}
        selectedDatabaseOrNotify={selectedDatabaseOrNotify}
        selectedDb={selectedDb}
        selectedProject={selectedProject}
        selectedTranslationLanguages={selectedTranslationLanguages}
        setSelectedTranslationLanguages={setSelectedTranslationLanguages}
        translationLanguages={translationLanguages}
      />

      <AdminPasswordDialog
        canUseDb={canUseDb}
        createJob={createJob}
        loading={loading}
        onOpenChange={setAdminPasswordOpen}
        open={adminPasswordOpen}
        selectedDatabaseOrNotify={selectedDatabaseOrNotify}
        selectedDb={selectedDb}
        selectedProject={selectedProject}
      />

      <CancelJobDialog
        jobs={jobs}
        jobToCancelId={jobToCancelId}
        pushToast={pushToast}
        refreshJobs={refreshJobs}
        setJobToCancelId={setJobToCancelId}
      />

      <UninstallModulesDialog
        createJob={createJob}
        loading={loading}
        onOpenChange={setUninstallDialogOpen}
        open={uninstallDialogOpen}
        pendingUninstallModules={pendingUninstallModules}
        refreshModules={refreshModules}
        schedule={schedule}
        selectedDb={selectedDb}
        selectedProject={selectedProject}
        setPendingUninstallModules={setPendingUninstallModules}
        setSelectedModules={setSelectedModules}
      />

      <DeleteModuleCodeDialog
        canUseDb={canUseDb}
        createJob={createJob}
        deleteCodeUninstallFirst={deleteCodeUninstallFirst}
        loading={loading}
        onOpenChange={setDeleteCodeDialogOpen}
        open={deleteCodeDialogOpen}
        pendingDeleteCodeModules={pendingDeleteCodeModules}
        refreshModules={refreshModules}
        schedule={schedule}
        selectedDb={selectedDb}
        selectedProject={selectedProject}
        setDeleteCodeUninstallFirst={setDeleteCodeUninstallFirst}
        setPendingDeleteCodeModules={setPendingDeleteCodeModules}
        setSelectedModules={setSelectedModules}
      />

      {showFloatingModuleActions && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center bg-gradient-to-t from-background via-background/85 to-transparent px-4 pb-4 pt-12 lg:left-80"
          role="region"
          aria-label="Actions sur les modules sélectionnés"
        >
          {/* Le dégradé estompe les lignes qui passent sous la barre ; la surface teintée la distingue du tableau. */}
          <ModuleSelectionBar {...moduleSelectionBarProps} floating />
        </div>
      )}

      <ToastStack toasts={toasts} raised={showFloatingModuleActions} />
    </main>
  );
}
