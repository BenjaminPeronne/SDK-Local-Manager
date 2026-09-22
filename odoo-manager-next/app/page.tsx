"use client";

import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DropdownMenu } from "@radix-ui/themes";
import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  Database,
  ExternalLink,
  FileArchive,
  Languages,
  Loader2,
  Logs,
  MoreHorizontal,
  PackageX,
  Play,
  PlusCircle,
  RefreshCcw,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { api, API_BASE, ApiUnavailableError, configureRuntimeApiBase, uploadDatabaseBackup } from "@/lib/api";
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
  sendTaskNotification,
} from "@/lib/desktop-runtime";
import { compactWorkspacePath } from "@/lib/format";
import { type JobOutputCache, mergeIncrementalJobOutput } from "@/lib/job-output";
import {
  isJobActive,
  isJobUnfinished,
  jobCompletionTitle,
  jobsFingerprint,
  PROJECT_ARRIVAL_PREFIXES,
} from "@/lib/jobs";
import { moduleOriginLabel, moduleRepositoryUrlError, normalizedModuleOrigin, socleAppInstalled } from "@/lib/modules";
import { fallbackManagerSettings, firstOdooDatabase, offlineDockerGuide } from "@/lib/projects";
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
  Toast,
} from "@/lib/types";
import { cn, delay } from "@/lib/utils";
import { isWslSetupPending } from "@/lib/wsl-setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Notice } from "@/components/common/notice";
import {
  REFINED_FOCUS_RING,
  REFINED_IDENTIFIER,
  REFINED_LABEL,
  REFINED_MODULE_COLUMNS,
  REFINED_ROW_TITLE,
  RefinedPanel,
  RefinedSectionHeader,
} from "@/components/common/refined-layout";
import { AdminPasswordDialog } from "@/components/databases/admin-password-dialog";
import { AllTranslationsResetDialog } from "@/components/databases/all-translations-reset-dialog";
import { CreateDatabaseDialog } from "@/components/databases/create-database-dialog";
import { DatabasesTab } from "@/components/databases/databases-tab";
import { DropDatabaseDialog } from "@/components/databases/drop-database-dialog";
import { NeutralizeDatabaseDialog } from "@/components/databases/neutralize-database-dialog";
import { RestoreDatabaseDialog } from "@/components/databases/restore-database-dialog";
import { ActivityTab } from "@/components/jobs/activity-tab";
import { CancelJobDialog } from "@/components/jobs/cancel-job-dialog";
import { DeleteModuleCodeDialog } from "@/components/modules/delete-module-code-dialog";
import { ModuleStateBadge } from "@/components/modules/module-badges";
import { RepositoryImportDialog } from "@/components/modules/repository-import-dialog";
import { SocleDialog } from "@/components/modules/socle-dialog";
import { TranslationResetDialog } from "@/components/modules/translation-reset-dialog";
import { UninstallModulesDialog } from "@/components/modules/uninstall-modules-dialog";
import { UpdateAllModulesDialog } from "@/components/modules/update-all-modules-dialog";
import { ZipImportDialog } from "@/components/modules/zip-import-dialog";
import { OnboardingDialog } from "@/components/onboarding/onboarding-dialog";
import { SshKeyDialog } from "@/components/onboarding/ssh-key-dialog";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { DeleteProjectDialog } from "@/components/projects/delete-project-dialog";
import { MigrationProposal } from "@/components/projects/migration-proposal";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectSettingsTab } from "@/components/projects/project-settings-tab";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { type SettingsSectionId } from "@/components/settings/settings-section";
import { AboutDialog } from "@/components/shell/about-dialog";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { WelcomeScreen } from "@/components/welcome/welcome-screen";
import { WslSetupDialog } from "@/components/wsl-setup";
import appIcon from "./icon.png";
import localIcon from "./local-icon.png";

// Distance de défilement sur laquelle le bandeau des onglets collés passe de transparent à opaque.
const TABS_BACKDROP_FADE_PX = 96;

const BOOTSTRAP_RETRY_DELAYS_MS = [0, 500, 1000, 2000];

const DOCKER_CONFIRM_DELAY_MS = 700;

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

  const [selectedDb, setSelectedDb] = useState("");
  // Base choisie pour chaque projet pendant la session : un rafraîchissement, une sonde Postgres
  // lente ou un aller-retour entre projets ne ramène plus à la première base de la liste.
  const rememberedDatabases = useRef<Record<string, string>>(readRememberedDatabases());
  // Projet auquel appartient `selectedDb` : à l'ouverture d'un autre projet, la base affichée
  // est encore celle du précédent et ne doit pas servir de référence.
  const databaseOwner = useRef("");
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [moduleSearch, setModuleSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [moduleOriginFilter, setModuleOriginFilter] = useState("all");
  const [modulePage, setModulePage] = useState(1);
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());
  const [socleDialogOpen, setSocleDialogOpen] = useState(false);
  const [selectedSoclePresets, setSelectedSoclePresets] = useState<Set<string>>(new Set());
  const [socleCatalog, setSocleCatalog] = useState<SocleCatalog | null>(null);
  const [loadingSocleCatalog, setLoadingSocleCatalog] = useState(false);
  const [socleSearch, setSocleSearch] = useState("");
  const [soclePlan, setSoclePlan] = useState<SocleInstallPlan | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobOutputCache = useRef<JobOutputCache>(new Map());
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
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
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [desktopRuntime, setDesktopRuntime] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
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
  const [pendingCreatedDatabase, setPendingCreatedDatabase] = useState<{ jobId: number; project: string; database: string } | null>(null);
  const toastId = useRef(1);
  const lastDockerState = useRef<string | null>(null);
  const pendingDockerState = useRef<{ state: string; count: number } | null>(null);
  const consecutiveApiFailures = useRef(0);
  const initializingRef = useRef(true);
  const bootstrapGeneration = useRef(0);
  const overviewRefreshInFlight = useRef(false);
  const systemRefreshInFlight = useRef(false);
  const jobsRefreshInFlight = useRef(false);
  const selectedJobIdRef = useRef<number | null>(null);
  const jobStatuses = useRef<Map<number, string>>(new Map());
  const jobNotificationsInitialized = useRef(false);
  const lastSynchronizedJobCompletion = useRef("");
  const modulesRequestGeneration = useRef(0);
  const scheduledTimeouts = useRef<Set<number>>(new Set());
  const onboardingPrompted = useRef(false);
  const wslSetupPrompted = useRef(false);
  const pendingProjectNames = useRef(new Set<string>());
  const logOutputRef = useRef<HTMLPreElement>(null);
  const previousSelectedJobRef = useRef<{ id: number | null; status: string | null }>({ id: null, status: null });
  const logAutoFollow = useRef(true);
  const lastLogOutputSource = useRef("");
  const logStreamRef = useRef<EventSource | null>(null);
  const logStreamFirstLineRef = useRef(true);

  const stopLiveLogStream = useCallback(() => {
    logStreamRef.current?.close();
    logStreamRef.current = null;
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
  const hasRunningJobs = useMemo(() => jobs.some(isJobUnfinished), [jobs]);
  const runningJobs = useMemo(
    () => jobs.filter(isJobUnfinished),
    [jobs],
  );
  const pendingProjectArrivals = useMemo(
    () => jobs.filter(
      (job) =>
        isJobUnfinished(job) &&
        PROJECT_ARRIVAL_PREFIXES.some((prefix) => job.title.startsWith(prefix)) &&
        Boolean(job.project) &&
        !(overview?.projects.some((project) => project.name === job.project)),
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

  const deferredModuleSearch = useDeferredValue(moduleSearch);
  const filteredModules = useMemo(() => {
    const query = deferredModuleSearch.trim().toLowerCase();
    return modules
      .filter((module) => !query || module.name.toLowerCase().includes(query))
      .filter((module) => (
        moduleFilter === "all" ||
        module.state === moduleFilter ||
        (moduleFilter === "uninstalled" && module.state === "disponible")
      ))
      .filter((module) => moduleOriginFilter === "all" || normalizedModuleOrigin(module.origin, module.source_path || module.path) === moduleOriginFilter);
  }, [deferredModuleSearch, modules, moduleFilter, moduleOriginFilter]);
  const refinedInterface = settings?.interface_layout === "refined";
  const stickyHeader = settings?.sticky_header ?? false;
  const projectHeaderRef = useRef<HTMLElement>(null);
  const [projectHeaderHeight, setProjectHeaderHeight] = useState(0);
  const projectTabsRef = useRef<HTMLDivElement>(null);
  const [projectTabsHeight, setProjectTabsHeight] = useState(0);
  const [projectHeaderCompact, setProjectHeaderCompact] = useState(false);

  useEffect(() => {
    if (!stickyHeader) {
      setProjectHeaderCompact(false);
      return;
    }
    const onScroll = () => {
      // Hystérésis : le passage en mode compact réduit la hauteur de l'en-tête, sans quoi il oscillerait au seuil.
      setProjectHeaderCompact((compact) => (compact ? window.scrollY > 8 : window.scrollY > 64));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [stickyHeader]);

  useEffect(() => {
    const tabs = projectTabsRef.current;
    if (!stickyHeader || !tabs) return;
    let frame = 0;
    // Variable CSS écrite directement : un état React re-rendrait toute la page à chaque pixel défilé.
    const update = () => {
      frame = 0;
      tabs.style.setProperty("--tabs-backdrop", String(Math.min(1, Math.max(0, window.scrollY / TABS_BACKDROP_FADE_PX))));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [stickyHeader, selectedProject?.name]);

  const [moduleSelectionBanner, setModuleSelectionBanner] = useState<HTMLDivElement | null>(null);
  const [moduleSelectionBannerVisible, setModuleSelectionBannerVisible] = useState(true);

  useEffect(() => {
    if (!moduleSelectionBanner) {
      setModuleSelectionBannerVisible(true);
      return;
    }
    // Avec l'en-tête fixe, le bandeau passé sous l'en-tête et les onglets est considéré comme masqué.
    const hiddenTop = stickyHeader && window.matchMedia("(min-width: 1024px)").matches ? projectHeaderHeight + (projectTabsHeight || 72) : 0;
    const observer = new IntersectionObserver(
      ([entry]) => setModuleSelectionBannerVisible(entry.isIntersecting),
      { rootMargin: `-${hiddenTop}px 0px 0px 0px` },
    );
    observer.observe(moduleSelectionBanner);
    return () => observer.disconnect();
  }, [moduleSelectionBanner, stickyHeader, projectHeaderHeight, projectTabsHeight]);

  // L'en-tête et les onglets n'existent qu'avec un projet ouvert : l'application démarre sur
  // l'accueil. Mesurés une seule fois au lancement, ils restaient à 0 px, et onglets comme
  // en-tête du tableau des modules se collaient en haut de l'écran, sous l'en-tête fixe.
  useEffect(() => {
    const header = projectHeaderRef.current;
    const tabs = projectTabsRef.current;
    if (!stickyHeader || !projectViewOpen || !header) return;
    const measure = () => {
      setProjectHeaderHeight(header.offsetHeight);
      setProjectTabsHeight(tabs?.offsetHeight ?? 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (tabs) observer.observe(tabs);
    measure();
    return () => observer.disconnect();
  }, [stickyHeader, projectViewOpen]);
  const modulesPerPage = 50;
  const modulePageCount = Math.max(1, Math.ceil(filteredModules.length / modulesPerPage));
  const visibleModules = useMemo(() => {
    const start = (modulePage - 1) * modulesPerPage;
    return filteredModules.slice(start, start + modulesPerPage);
  }, [filteredModules, modulePage, modulesPerPage]);

  const moduleByName = useMemo(() => new Map(modules.map((module) => [module.name, module])), [modules]);
  const installedSoclePresetIds = useMemo<Set<string>>(
    () => new Set<string>((socleCatalog?.apps ?? []).filter(socleAppInstalled).map((app) => app.id)),
    [socleCatalog],
  );
  const soclePresetsToInstall = useMemo(
    () => Array.from(selectedSoclePresets).filter((presetId) => !installedSoclePresetIds.has(presetId)).sort(),
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
  const filteredModuleNames = useMemo(() => filteredModules.map((module) => module.name), [filteredModules]);
  const selectedFilteredModuleCount = useMemo(
    () => filteredModuleNames.filter((name) => selectedModules.has(name)).length,
    [filteredModuleNames, selectedModules],
  );
  const allFilteredModulesSelected = filteredModuleNames.length > 0 && selectedFilteredModuleCount === filteredModuleNames.length;
  const fallbackDockerGuide = useMemo(() => offlineDockerGuide(), []);
  const showModuleLocations = settings?.show_technical_details ?? false;
  const moduleTableGridColumns = showModuleLocations
    ? "xl:grid-cols-[minmax(210px,1.35fr)_100px_110px_150px_minmax(220px,1.15fr)_200px]"
    : "xl:grid-cols-[minmax(210px,1.35fr)_100px_110px_150px_200px]";

  const schedule = useCallback((callback: () => void | Promise<void>, delay: number) => {
    const timeout = window.setTimeout(() => {
      scheduledTimeouts.current.delete(timeout);
      void callback();
    }, delay);
    scheduledTimeouts.current.add(timeout);
  }, []);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = toastId.current++;
    setToasts((current) => [...current, { id, kind, message }]);
    schedule(() => setToasts((current) => current.filter((toast) => toast.id !== id)), kind === "error" ? 8000 : 4200);
    if (kind === "error") {
      void fetch(`${API_BASE}/api/errors/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      }).catch(() => undefined);
    }
  }, [schedule]);

  const notifyJobCompletion = useCallback((job: Job) => {
    const successful = job.status === "done";
    const title = `${jobCompletionTitle(job)} : ${job.title}`;
    const message = !successful && job.error_message ? `${title}\n${job.error_message}` : title;
    pushToast(successful ? "success" : job.status === "cancelled" ? "info" : "error", message);
    void sendTaskNotification(job).catch(() => {
      // A refused system permission must not affect job polling.
    });
  }, [pushToast]);

  const applyJobs = useCallback((receivedJobs: Job[], notify = true) => {
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
    setJobs((current) => jobsFingerprint(current) === jobsFingerprint(nextJobs) ? current : nextJobs);
  }, [notifyJobCompletion]);

  const markApiSuccess = useCallback(() => {
    consecutiveApiFailures.current = 0;
    setApiUnavailable(false);
  }, []);

  const markApiFailure = useCallback((error: unknown) => {
    if (!(error instanceof ApiUnavailableError)) return false;
    consecutiveApiFailures.current += 1;
    if (consecutiveApiFailures.current >= 2) setApiUnavailable(true);
    return consecutiveApiFailures.current === 2;
  }, []);

  const applyBootstrapSnapshot = useCallback((payload: BootstrapSnapshot) => {
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
    setSelectedJobId((currentId) => payload.jobs.some((job) => job.id === currentId) ? currentId : payload.jobs[0]?.id ?? null);
    lastDockerState.current = payload.system_status.docker.state;
    pendingDockerState.current = null;
    markApiSuccess();
    setError("");
  }, [applyJobs, markApiSuccess]);

  const commitSystemStatus = useCallback((payload: SystemStatus, immediate = false) => {
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
  }, [markApiSuccess, pushToast]);

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

  const applyOverview = useCallback((payload: Overview) => {
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
  }, [markApiSuccess]);

  const refreshOverview = useCallback(async () => {
    if (overviewRefreshInFlight.current) return;
    overviewRefreshInFlight.current = true;
    try {
      const payload = await api<Overview>("/api/overview");
      applyOverview(payload);
    } catch (err) {
      markApiFailure(err);
      setError(!initializingRef.current && !(err instanceof ApiUnavailableError) ? err instanceof Error ? err.message : "Impossible de charger l'overview." : "");
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
    window.sdkDesktop?.rikaCredentials().then(setStoredRikaCredentials).catch(() => setStoredRikaCredentials(null));
    window.sdkDesktop?.gitlabStatus().then(setGitlabStatus).catch(() => setGitlabStatus(null));
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

  const refreshJobs = useCallback(async (detailJobId?: number | null) => {
    if (jobsRefreshInFlight.current) return;
    jobsRefreshInFlight.current = true;
    try {
      const requestedJobId = detailJobId ?? selectedJobIdRef.current;
      const knownOutput = requestedJobId ? jobOutputCache.current.get(requestedJobId) : undefined;
      const params = new URLSearchParams();
      if (requestedJobId) params.set("detail", String(requestedJobId));
      if (requestedJobId && knownOutput?.total) params.set("output_from", String(knownOutput.total));
      const query = params.size ? `?${params}` : "";
      const payload = await api<{ jobs: Job[] }>(`/api/jobs${query}`);
      applyJobs(payload.jobs);
      markApiSuccess();
      setSelectedJobId((currentId) => currentId ?? payload.jobs[0]?.id ?? null);
    } catch (err) {
      markApiFailure(err);
      // Jobs polling should not break the whole screen.
    } finally {
      jobsRefreshInFlight.current = false;
    }
  }, [applyJobs, markApiFailure, markApiSuccess]);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

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
      pushToast("error", err instanceof Error ? err.message : "Impossible de charger les modules.");
    } finally {
      if (generation === modulesRequestGeneration.current) setLoadingModules(false);
    }
  }, [pushToast, selectedDb, selectedProject?.name]);

  useEffect(() => {
    const completionKey = jobs
      .filter((job) => job.project === selectedProject?.name && job.status !== "running")
      .map((job) => `${job.id}:${job.status}:${job.finished_at || ""}`)
      .join("|");
    if (!completionKey || completionKey === lastSynchronizedJobCompletion.current) return;
    lastSynchronizedJobCompletion.current = completionKey;
    void Promise.all([refreshOverview(), refreshModules(), refreshAddonLinks()]);
  }, [jobs, refreshAddonLinks, refreshModules, refreshOverview, selectedProject?.name]);

  useEffect(() => () => {
    for (const timeout of scheduledTimeouts.current) window.clearTimeout(timeout);
    scheduledTimeouts.current.clear();
  }, []);

  useEffect(() => {
    setDesktopRuntime(isDesktopRuntime());
    void applicationVersion().then(setAppVersion);
    void configureRuntimeApiBase()
      .then(initializeApplication)
      .catch((err) => {
        setInitializationError(err instanceof Error ? err.message : "Impossible de déterminer le port du gestionnaire.");
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
    ) return;
    onboardingPrompted.current = true;
    setOnboardingOpen(true);
    void loadCreationPrerequisites();
  }, [initializing, loadCreationPrerequisites, overview, settings]);

  // Sous Windows, les projets servis depuis C:\ sont 10 fois plus lents que dans
  // l'environnement Linux : la préparation est proposée dès qu'elle manque.
  useEffect(() => {
    const bridge = desktopBridge();
    if (initializing || !bridge?.wslStatus) return;
    bridge.wslStatus().then(setWslStatus).catch(() => setWslStatus(null));
  }, [initializing]);

  // Le repli sur le backend Windows se décide au démarrage : l'interface dit pourquoi le poste
  // est redevenu lent, au lieu de laisser l'utilisateur le découvrir à l'usage.
  useEffect(() => {
    const bridge = desktopBridge();
    if (initializing || !bridge?.backendMode) return;
    bridge.backendMode()
      .then((mode) => setDegradedBackendReason(mode?.degradedReason || ""))
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
    const job = jobs.find((item) => item.project === pendingCreatedProjectName && item.title.startsWith("Créer le projet "));
    if (job?.status !== "error") return;
    pendingProjectNames.current.delete(pendingCreatedProjectName);
    setSelectedProjectName((currentName) => currentName === pendingCreatedProjectName ? "" : currentName);
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
    const timer = window.setInterval(refreshWhenVisible, hasRunningJobs ? 1200 : 10000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [hasRunningJobs, initializing, refreshJobs]);

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
    return () => source.close();
  }, [applyOverview, commitSystemStatus, initializing, refreshJobs, refreshOverview]);

  useEffect(() => {
    if (!selectedProject) return;
    const remembered = rememberedDatabases.current[selectedProject.name];
    const sameProject = databaseOwner.current === selectedProject.name;
    databaseOwner.current = selectedProject.name;
    setSelectedDb((current) => databaseToKeep(selectedProject.databases, sameProject ? current : remembered || "", remembered));
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
      setSelectedJobId(result.job.id);
      jobStatuses.current.set(result.job.id, result.job.status);
      setExternalLogView(null);
      enableLogAutoFollow();
      if (result.job.status === "queued") {
        pushToast("info", `Action en attente : ${result.job.title}${result.job.waiting_for ? ` (${result.job.waiting_for.toLowerCase()})` : ""}. Elle démarrera automatiquement.`);
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
      setSocleCatalog(await api<SocleCatalog>(`/api/projects/${encodeURIComponent(selectedProject.name)}/socle?${params}`));
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
          pushToast("error", nativeError instanceof Error ? nativeError.message : "Impossible d'ouvrir Docker Desktop.");
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
    const prerequisites = creationPrerequisites || await loadCreationPrerequisites();
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
        body: JSON.stringify({ interface_layout: "refined", sticky_header: true, beta_interface_banner_dismissed: true }),
      });
      setSettings(payload.settings);
      setSettingsDraft(payload.settings);
      pushToast("success", "Nouvelle interface activée. Retour à l’interface classique possible dans Paramètres, section Apparence.");
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

  async function openSshAssistant(regenerate = false) {
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
      pushToast("error", `Sélectionne une base Odoo avant de lancer ${action}. La base technique postgres n'est pas utilisable ici.`);
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
      const diagnostics = await api<ProjectDiagnostics>(`/api/projects/${encodeURIComponent(selectedProject.name)}/diagnostics`);
      const database = diagnostics.databases?.find((item) => item.name === db);
      setUpdateFilestoreStatus(database?.filestore || null);
      setUpdatePendingModules(
        database?.pending_modules ||
        (database?.pending_missing_modules || []).map((name) => ({ name, state: "en attente", code_available: false })),
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

  function selectJob(jobId: number) {
    stopLiveLogStream();
    setExternalLogView(null);
    setSelectedJobId(jobId);
    selectedJobIdRef.current = jobId;
    setRawOutputVisible(false);
    enableLogAutoFollow();
    void refreshJobs(jobId);
  }

  function requestUninstall(moduleNames: string[]) {
    const installed = moduleNames.filter((name) => modules.find((module) => module.name === name)?.state === "installed");
    if (!installed.length) {
      pushToast("error", "Sélectionne au moins un module installé.");
      return;
    }
    setPendingUninstallModules(installed);
    setUninstallDialogOpen(true);
  }

  function requestTranslationReset(moduleNames: string[]) {
    const installed = moduleNames.filter((name) => modules.find((module) => module.name === name)?.state === "installed");
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
      const module = modules.find((candidate) => candidate.name === name);
      return module?.removable && module.removal_mode !== "link_only";
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

  async function restoreDatabaseBackup(
    payload: RestoreDatabasePayload,
    onProgress: (progress: number) => void,
  ) {
    setLoading(true);
    void requestTaskNotificationPermission().catch(() => {
      // The in-app completion toast remains available if system notifications are refused.
    });
    try {
      const result = await uploadDatabaseBackup(payload, onProgress);
      setSelectedJobId(result.job.id);
      jobStatuses.current.set(result.job.id, result.job.status);
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
        const module = moduleByName.get(name);
        return module?.removable && module.removal_mode !== "link_only";
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
  const repositoryInspectionKey = repositoryOpen && repositoryUrl.trim() && !repositoryUrlError && repositoryBranch.trim()
    ? `${selectedProject?.name || ""}|${repositoryUrl.trim()}|${repositoryBranch.trim()}`
    : "";
  const soclePlanKey = socleDialogOpen && canUseDb ? soclePresetsToInstall.join(",") : "";
  const scopedExternalLogView = externalLogView?.project === selectedProject?.name ? externalLogView : null;
  const outputContent = scopedExternalLogView?.content || selectedJob?.output || selectedJob?.lines?.join("\n") || "Aucune sortie.";
  const outputSource = scopedExternalLogView ? `external:${scopedExternalLogView.title}` : `job:${selectedJob?.id || "none"}`;

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
    if (previous.id === current.id && previous.status && isJobUnfinished({ status: previous.status }) && current.status && !isJobUnfinished({ status: current.status })) {
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

  useEffect(() => {
    setModulePage(1);
  }, [deferredModuleSearch, moduleFilter, moduleOriginFilter, selectedDb, selectedProject?.name, modulesPerPage]);

  useEffect(() => {
    if (modulePage > modulePageCount) setModulePage(modulePageCount);
  }, [modulePage, modulePageCount]);

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

  const toggleModuleSelection = useCallback((name: string, checked: boolean) => {
    setSelectedModules((current) => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);

  const toggleModuleFromRow = useCallback((event: ReactMouseEvent<HTMLElement>, name: string) => {
    const target = event.target as HTMLElement;
    // Les contrôles gardent leur action, y compris les menus rendus en portail dont les clics remontent jusqu'ici.
    if (target.closest("button, a, input, select, textarea, label, [role=menu], [role=menuitem], [role=dialog]")) return;
    // Sélectionner un nom ou un chemin pour le copier ne coche pas la ligne.
    if (window.getSelection()?.toString()) return;
    setSelectedModules((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }, []);

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
      <main className="sdk-shell grid min-h-screen place-items-center bg-background px-6">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <img
            src={selectedAppIcon.src}
            alt="SDK Local Manager"
            className={cn(
              "mx-auto h-16 w-16 object-cover",
              settings?.interface_icon === "local" ? "rounded-full" : "rounded-[15px]",
            )}
          />
          <div className="mt-3 flex justify-center">
            {initializationError ? (
              <AlertTriangle className="h-6 w-6 text-amber-600" />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            )}
          </div>
          <h1 className="mt-4 text-lg font-semibold">Chargement du gestionnaire</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {initializationMessage}
          </p>
          {initializationError && (
            <div className="mt-4 space-y-3">
              <p className="break-words rounded-md border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                {initializationError}
              </p>
              {backendDiagnostics && (
                <details className="rounded-md border bg-muted/40 p-3 text-left text-xs">
                  <summary className="cursor-pointer font-medium">Détails techniques</summary>
                  <div className="mt-2 break-all text-muted-foreground">Journal : {backendDiagnostics.log_path}</div>
                  <pre className="log-terminal mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-2 text-[11px] text-slate-100">
                    {backendDiagnostics.details}
                  </pre>
                </details>
              )}
              <Button className="w-full" onClick={initializeApplication}>
                <RefreshCcw className="h-4 w-4" />
                Réessayer
              </Button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Filtres et sélection des modules : identiques en affichage classique et affiné.
  const moduleFiltersBlock = (
    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_210px_220px]">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Rechercher par nom de module" value={moduleSearch} onChange={(event) => setModuleSearch(event.target.value)} />
      </div>
      <Select value={moduleFilter} onValueChange={setModuleFilter}>
        <SelectTrigger placeholder="État">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les états</SelectItem>
          <SelectItem value="installed">Installés</SelectItem>
          <SelectItem value="uninstalled">Disponibles</SelectItem>
          <SelectItem value="to upgrade">À mettre à jour</SelectItem>
        </SelectContent>
      </Select>
      <Select value={moduleOriginFilter} onValueChange={setModuleOriginFilter}>
        <SelectTrigger placeholder="Origine">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les origines</SelectItem>
          <SelectItem value="enterprise">Odoo Enterprise</SelectItem>
          <SelectItem value="other">Autre</SelectItem>
        </SelectContent>
      </Select>
      <Select value={selectedDb} onValueChange={(db) => chooseDatabase(db)}>
        <SelectTrigger placeholder="Base Odoo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {odooDatabases.map((db) => (
            <SelectItem key={db} value={db}>
              {db}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  function moduleSelectionBar(floating = false) {
    const count = selectedModuleList.length;
    const installable = selectedInstallableModuleList.length;
    const installed = selectedInstalledModuleList.length;
    const removable = selectedRemovableModuleList.length;
    const busy = !canUseDb || loading;
    const clearSelection = () => setSelectedModules(new Set());
    const details = [installable && `${installable} disponible(s)`, installed && `${installed} installé(s)`].filter(Boolean).join(", ");
    const selectAllFiltered = !allFilteredModulesSelected && filteredModuleNames.length > 0 && (
      <button
        type="button"
        className={cn("shrink-0 rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline", REFINED_FOCUS_RING)}
        onClick={() => toggleFilteredModules(true)}
      >
        Tout sélectionner ({filteredModuleNames.length})
      </button>
    );

    if (!count) {
      return (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/45 px-3 py-2.5 text-sm">
          <Checkbox
            checked={false}
            disabled={!filteredModuleNames.length}
            onCheckedChange={() => toggleFilteredModules(true)}
            aria-label={`Sélectionner les ${filteredModuleNames.length} modules affichés par la recherche`}
          />
          <span className="min-w-0 flex-1 text-muted-foreground">Coche des modules pour agir dessus.</span>
          {selectAllFiltered}
        </div>
      );
    }

    // Seules les actions applicables sont proposées ; l'action la plus probable est pleine.
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm",
          floating
            ? "floating-selection-bar pointer-events-auto max-w-full justify-center rounded-xl border border-primary/45 p-2 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.45)] ring-1 ring-black/5 dark:ring-white/10"
            : "rounded-md border border-primary/35 bg-primary/[0.06] px-3 py-2 dark:bg-primary/[0.12]",
        )}
      >
        {/* Deux groupes : en largeur réduite, les actions passent ensemble à la ligne, jamais bouton par bouton. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Checkbox
            checked={allFilteredModulesSelected && count === filteredModuleNames.length ? true : "indeterminate"}
            onCheckedChange={clearSelection}
            aria-label="Désélectionner tous les modules"
            title="Désélectionner tous les modules"
          />
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 pr-1">
            <span className="font-semibold">{count} sélectionné(s)</span>
            {details && <span className="text-muted-foreground">· {details}</span>}
          </span>
          {!floating && selectAllFiltered}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {installable > 0 && (
            <Button
              size="sm"
              variant="success"
              disabled={busy}
              onClick={() => createJob("install_module", { project: selectedProject?.name, db: selectedDb, modules: selectedInstallableModuleList.join(",") })}
            >
              <PlusCircle className="h-4 w-4" />
              Installer ({installable})
            </Button>
          )}
          {installed > 0 && (
            <Button
              size="sm"
              variant={installable > 0 ? "outline" : "default"}
              disabled={busy}
              onClick={() => createJob("update_module", { project: selectedProject?.name, db: selectedDb, modules: selectedInstalledModuleList.join(",") })}
            >
              <RefreshCcw className="h-4 w-4" />
              Mettre à jour ({installed})
            </Button>
          )}
          {installed > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-red-300 text-red-700 hover:border-red-400 hover:bg-red-50 hover:text-red-800 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/60"
              disabled={busy}
              onClick={() => requestUninstall(selectedInstalledModuleList)}
            >
              <PackageX className="h-4 w-4" />
              Désinstaller ({installed})
            </Button>
          )}
          {(installed > 0 || removable > 0) && (
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger>
                <Button size="sm" variant="outline" disabled={loading} aria-label="Autres actions sur la sélection">
                  <MoreHorizontal className="h-4 w-4" />
                  Plus
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" className="min-w-60">
                <DropdownMenu.Item disabled={!installed || busy} onSelect={() => requestTranslationReset(selectedInstalledModuleList)}>
                  <Languages className="h-4 w-4" />
                  Réinitialiser les traductions ({installed})
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item color="red" disabled={!removable} onSelect={() => requestDeleteCode(selectedRemovableModuleList)}>
                  <Trash2 className="h-4 w-4" />
                  Supprimer le code du projet ({removable})
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
          <span className="mx-0.5 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <Button size="sm" variant="ghost" onClick={clearSelection} title="Désélectionner tous les modules (Échap)">
            <X className="h-4 w-4" />
            Désélectionner
            <kbd className="ml-0.5 rounded border px-1 font-mono text-[10px] font-normal text-muted-foreground">Échap</kbd>
          </Button>
        </div>
      </div>
    );
  }

  const showFloatingModuleActions =
    activeTab === "modules" && selectedModuleList.length > 0 && Boolean(moduleSelectionBanner) && !moduleSelectionBannerVisible;

  // Le ref suit la barre en place : quand elle sort de l'écran, sa copie flottante prend le relais.
  const moduleSelectionBlock = <div ref={setModuleSelectionBanner}>{moduleSelectionBar()}</div>;

  const modulePaginationBlock = filteredModules.length > 0 && (
    <div className="flex flex-col gap-3 border-t bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-muted-foreground">
        {Math.min((modulePage - 1) * modulesPerPage + 1, filteredModules.length)}–{Math.min(modulePage * modulesPerPage, filteredModules.length)} sur {filteredModules.length} module(s)
      </span>
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" disabled={modulePage <= 1} onClick={() => setModulePage((page) => Math.max(1, page - 1))} aria-label="Page précédente" title="Page précédente">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-20 text-center tabular-nums">Page {modulePage}/{modulePageCount}</span>
        <Button size="icon" variant="outline" disabled={modulePage >= modulePageCount} onClick={() => setModulePage((page) => Math.min(modulePageCount, page + 1))} aria-label="Page suivante" title="Page suivante">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const moduleEmptyState = (
    <div className="grid justify-items-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <span>
        {loadingModules
          ? "Lecture des modules du projet…"
          : modules.length
            ? "Aucun module ne correspond aux filtres actuels."
            : "Aucun module Odoo n’a été détecté dans les dossiers addons du projet."}
      </span>
      {!loadingModules && (moduleSearch || moduleFilter !== "all" || moduleOriginFilter !== "all") && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setModuleSearch("");
            setModuleFilter("all");
            setModuleOriginFilter("all");
          }}
        >
          Réinitialiser les filtres
        </Button>
      )}
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
              <Notice
                tone="danger"
                icon={AlertTriangle}
                title="Service local indisponible"
                actions={
                  <>
                    <Button className="w-full sm:w-auto" size="sm" onClick={() => Promise.all([refreshOverview(), refreshSystemStatus(), loadSettings()])}>
                      <RefreshCcw className="h-4 w-4" />
                      Réessayer
                    </Button>
                    <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => openUrl(fallbackDockerGuide.download_url)}>
                      <CloudDownload className="h-4 w-4" />
                      Télécharger Docker
                    </Button>
                    <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => openUrl(fallbackDockerGuide.install_url)}>
                      <ExternalLink className="h-4 w-4" />
                      Guide Docker
                    </Button>
                    <Button className="w-full sm:w-auto" size="sm" variant="outline" disabled={!desktopRuntime} onClick={requestDockerStart}>
                      <Play className="h-4 w-4" />
                      Ouvrir Docker
                    </Button>
                  </>
                }
              >
                L'application n'arrive pas à joindre son API locale. Attends quelques secondes puis actualise. Si Docker n'est pas encore installé,
                installe Docker Desktop avant de lancer les projets Odoo.
                <div className="mt-3 rounded-md border border-red-200 bg-white/70 p-3 text-red-950 dark:border-red-800 dark:bg-red-950/55 dark:text-red-50">
                  <div className="font-medium">{fallbackDockerGuide.title}</div>
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5">
                    {fallbackDockerGuide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
              </Notice>
            )}
            {degradedBackendReason && (
              <Notice
                tone="warning"
                icon={AlertTriangle}
                title="Mode Windows, plus lent"
                actions={
                  <>
                    <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => openUrl("https://aka.ms/enablevirtualization")}>
                      <ExternalLink className="h-4 w-4" />
                      Guide Microsoft
                    </Button>
                    <Button className="w-full sm:w-auto" size="sm" disabled={!desktopBridge()?.relaunch} onClick={() => desktopBridge()?.relaunch?.()}>
                      <RefreshCcw className="h-4 w-4" />
                      Relancer
                    </Button>
                  </>
                }
              >
                {degradedBackendReason} Les projets restent utilisables depuis Windows, mais Odoo y démarre en une minute environ, contre quelques secondes dans l’environnement Linux.
              </Notice>
            )}
            {systemStatus && !systemStatus.docker.running && (
              <Notice
                tone="warning"
                icon={AlertTriangle}
                title="Docker n’est pas disponible"
                actions={
                  <>
                    {systemStatus.docker.state === "missing" && systemStatus.docker.install_guide?.download_url && (
                      <Button className="w-full sm:w-auto" size="sm" onClick={() => openUrl(systemStatus.docker.install_guide?.download_url)}>
                        <CloudDownload className="h-4 w-4" />
                        Télécharger Docker
                      </Button>
                    )}
                    {systemStatus.docker.can_start && (
                      <Button className="w-full sm:w-auto" size="sm" disabled={loading} onClick={requestDockerStart}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        Ouvrir Docker
                      </Button>
                    )}
                    {systemStatus.docker.install_guide?.install_url && (
                      <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => openUrl(systemStatus.docker.install_guide?.install_url)}>
                        <ExternalLink className="h-4 w-4" />
                        Guide Docker
                      </Button>
                    )}
                    <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={openSettingsDialog}>
                      <Settings className="h-4 w-4" />
                      Paramètres
                    </Button>
                  </>
                }
              >
                {systemStatus.docker.message}
                {systemStatus.docker.state === "missing" && systemStatus.docker.install_guide && (
                  <div className="mt-3 rounded-md border border-amber-200 bg-white/70 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/55 dark:text-amber-50">
                    <div className="font-medium">{systemStatus.docker.install_guide.title}</div>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5">
                      {systemStatus.docker.install_guide.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </Notice>
            )}
            {systemStatus?.traefik && !systemStatus.traefik.running && (
              <Notice
                tone="info"
                icon={AlertTriangle}
                title="Traefik n’est pas prêt"
                actions={
                  <>
                    {systemStatus.traefik.state === "port_busy" && desktopBridge()?.stopLegacyTraefik ? (
                      <Button
                        className="w-full sm:w-auto"
                        size="sm"
                        disabled={loading}
                        title="Les projets restés sous Docker Desktop ne seront plus accessibles par leur adresse tant qu’il est arrêté."
                        onClick={requestLegacyTraefikStop}
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                        Arrêter l’ancien Traefik
                      </Button>
                    ) : (
                      <Button
                        className="w-full sm:w-auto"
                        size="sm"
                        disabled={!systemStatus.docker.running || loading}
                        onClick={requestTraefikInstall}
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {systemStatus.traefik.installed ? "Démarrer Traefik" : "Installer Traefik"}
                      </Button>
                    )}
                    <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={openSettingsDialog}>
                      <Settings className="h-4 w-4" />
                      Paramètres
                    </Button>
                  </>
                }
              >
                {systemStatus.traefik.message}
                {systemStatus.traefik.requires_docker ? " Docker doit être installé et démarré avant cette étape." : ""}
                <div className="mt-1 break-all text-xs opacity-80">Dossier attendu : {systemStatus.traefik.path}</div>
              </Notice>
            )}
            {migrationBannerVisible && (
              <Notice
                tone="success"
                icon={Rocket}
                title="Ces projets peuvent démarrer bien plus vite"
                onDismiss={() => setMigrationBannerClosed(true)}
                dismissLabel="Masquer jusqu’au prochain démarrage"
              >
                <span title={migration?.source}>
                  Ils sont encore rangés sur ton disque Windows, où Odoo met près d’une minute à démarrer ; ici, quelques secondes.
                  Le gestionnaire en fait une copie et ne touche pas au dossier d’origine.
                </span>
                <div className="mt-3 flex flex-col gap-3">
                  <MigrationProposal candidates={migrationCandidates} loading={loading} onMigrate={requestProjectMigration} />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void dismissMigrationProposal()}
                    >
                      Ne plus proposer
                    </button>
                    <span>Les projets resteront copiables depuis Paramètres, section Général.</span>
                  </div>
                </div>
              </Notice>
            )}
            {(systemStatus?.abandoned_staging?.count ?? 0) > 0 && (
              <Notice
                tone="neutral"
                icon={Trash2}
                title="Créations de projet interrompues"
                actions={
                  <Button className="w-full sm:w-auto" size="sm" variant="outline" disabled={loading} onClick={requestStagingCleanup}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Nettoyer
                  </Button>
                }
              >
                {systemStatus!.abandoned_staging!.count} dossier(s) de préparation occupent de l’espace disque sans servir à aucun projet. Les supprimer ne touche à aucun projet ni à aucune base.
              </Notice>
            )}
            {selectedProject && addonLinks?.supported && (addonLinks.wsl_links > 0 || addonLinks.interrupted) && (
              <Notice
                tone="warning"
                icon={AlertTriangle}
                title={addonLinks.interrupted ? "Conversion des liens d’addons interrompue" : "Liens d’addons créés par une ancienne version"}
                actions={
                  <>
                    <Button
                      className="w-full sm:w-auto"
                      size="sm"
                      disabled={loading || !addonLinks.native_symlinks || selectedProjectOnline}
                      onClick={convertWslAddonLinks}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                      {addonLinks.interrupted ? "Reprendre la conversion" : "Convertir les liens"}
                    </Button>
                    <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => void refreshAddonLinks()}>
                      Vérifier à nouveau
                    </Button>
                  </>
                }
              >
                {addonLinks.interrupted
                  ? "Relance la conversion pour la terminer : certains modules peuvent être absents tant qu’elle n’est pas achevée."
                  : `${addonLinks.wsl_links} lien(s) de ce projet ont été créés par WSL. Windows ne peut pas les lire, ce qui ralentit fortement la liste des modules. La conversion les remplace par des liens Windows identiques, lus par Windows et par Docker.`}
                {!addonLinks.native_symlinks && (
                  <div className="mt-1 text-xs opacity-80">
                    Active d’abord le mode développeur Windows : Paramètres &gt; Système &gt; Espace développeurs.
                  </div>
                )}
                {addonLinks.native_symlinks && selectedProjectOnline && (
                  <div className="mt-1 text-xs opacity-80">Arrête le projet avant la conversion.</div>
                )}
              </Notice>
            )}
            {error && (
              <Notice tone="danger" icon={AlertTriangle} title="L’action a échoué">
                {error}
              </Notice>
            )}
            {settings?.interface_layout === "classic" && !settings.beta_interface_banner_dismissed && (
              <Notice
                tone="accent"
                icon={Sparkles}
                title="Essaie la nouvelle interface (bêta)"
                onDismiss={() => void dismissRefinedInterfaceProposal()}
                dismissLabel="Ne plus proposer"
                actions={
                  <Button className="w-full sm:w-auto" size="sm" onClick={() => void switchToRefinedInterface()}>
                    <Sparkles className="h-4 w-4" />
                    Passer à la nouvelle interface
                  </Button>
                }
              >
                Présentation affinée et en-tête fixe : le nom du projet et ses actions restent visibles pendant le défilement. Retour à l’interface classique possible à tout moment dans Paramètres, section Apparence.
              </Notice>
            )}
            {runningJobs.length > 0 && (
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
                          onClick={() => {
                            if (job.project) {
                              setSelectedProjectName(job.project);
                              setSelectedDb((currentDb) => currentDb || "postgres");
                            }
                            selectJob(job.id);
                            setActiveTab("logs");
                          }}
                        >
                          <Logs className="h-4 w-4" />
                          <span className="max-w-72 truncate">Suivre : {job.title}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showWelcome ? (
              <WelcomeScreen
                icon={selectedAppIcon}
                hasProjects={Boolean(overview?.projects.length)}
                docker={{
                  ready: Boolean(systemStatus?.docker.running),
                  message: systemStatus?.docker.message || "Vérification en cours…",
                }}
                traefik={systemStatus?.traefik ? { ready: systemStatus.traefik.running, message: systemStatus.traefik.message } : null}
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
                    stickyHeader &&
                      "-my-2 py-2 lg:sticky lg:z-20 lg:before:pointer-events-none lg:before:absolute lg:before:inset-y-0 lg:before:-inset-x-[100vw] lg:before:-z-10 lg:before:border-b lg:before:bg-background/90 lg:before:opacity-[var(--tabs-backdrop,0)] lg:before:backdrop-blur lg:before:transition-opacity lg:before:duration-300 lg:before:ease-out motion-reduce:lg:before:transition-none",
                  )}
                  style={stickyHeader ? { top: projectHeaderHeight } : undefined}
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
                  <TabsContent value="modules">
                    {refinedInterface ? (
                      <div className="space-y-4">
                        <RefinedSectionHeader
                          title="Modules"
                          count={filteredModules.length}
                          description="Les actions s’appliquent à la base de travail sélectionnée."
                          actions={
                            <>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => void refreshModules()}
                                disabled={loadingModules}
                                aria-label="Actualiser la liste des modules"
                                title="Actualiser la liste des modules"
                              >
                                <RefreshCcw className={cn("h-4 w-4", loadingModules && "animate-spin")} />
                              </Button>
                              {/* Les imports de code sont regroupés : ils mènent tous à « ajouter des modules au projet ».
                                  Menus non modaux : le verrou de défilement de Radix détache l'en-tête et la barre latérale collés. */}
                              <DropdownMenu.Root modal={false}>
                                <DropdownMenu.Trigger>
                                  <Button variant="outline" disabled={!selectedProjectReady}>
                                    <PlusCircle className="h-4 w-4" />
                                    Ajouter des modules
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Content align="end" className="min-w-64">
                                  <DropdownMenu.Item disabled={loading} onSelect={() => setRepositoryOpen(true)}>
                                    <CloudDownload className="h-4 w-4" />
                                    Depuis un dépôt Git (SSH)
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item onSelect={() => setZipDialogOpen(true)}>
                                    <FileArchive className="h-4 w-4" />
                                    Depuis un pauvre zip
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Root>
                              <Button variant="outline" onClick={openSocleDialog} disabled={!selectedProjectReady || loading}>
                                <Boxes className="h-4 w-4" />
                                Installer un socle
                              </Button>
                              <Button
                                disabled={!selectedProjectReady || loading || checkingUpdatePrerequisites}
                                onClick={requestUpdateAllOdooModules}
                              >
                                {checkingUpdatePrerequisites ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                                MAJ complète Odoo
                              </Button>
                            </>
                          }
                        />
                        {moduleFiltersBlock}
                        {moduleSelectionBlock}
                        {/* overflow-clip arrondit les coins sans créer de conteneur de défilement, contrairement à
                            overflow-hidden qui empêcherait l'en-tête de rester collé. L'en-tête reste donc un bandeau droit :
                            des coins arrondis collés en haut laisseraient voir les lignes qui défilent derrière. */}
                        <RefinedPanel className="overflow-clip">
                          <div
                            className="z-10 hidden border-b bg-card xl:sticky xl:block"
                            style={{ top: stickyHeader ? projectHeaderHeight + projectTabsHeight : 0 }}
                          >
                            <div className={cn("grid items-center gap-3 bg-muted/60 px-3 py-2", REFINED_LABEL, REFINED_MODULE_COLUMNS)}>
                              <div>Module</div>
                              <div>État</div>
                              <div>Version</div>
                              <div>Origine</div>
                              <div className="text-right">Actions</div>
                            </div>
                          </div>
                          <div className="min-w-0">
                            {visibleModules.length ? (
                              visibleModules.map((module) => {
                                const sourcePath = module.source_path || module.path;
                                const linkPath = module.link_path || (module.path_kind?.startsWith("lien") ? module.path : "");
                                const displaySourcePath = compactWorkspacePath(sourcePath, overview?.workspace);
                                const displayLinkPath = compactWorkspacePath(linkPath, overview?.workspace);
                                const samePaths = Boolean(linkPath && sourcePath && linkPath === sourcePath);
                                const origin = normalizedModuleOrigin(module.origin, sourcePath);
                                const moduleTitle = module.title || module.name;
                                const showTechnicalName = moduleTitle !== module.name;
                                const moduleSelected = selectedModules.has(module.name);
                                return (
                                  <div
                                    key={module.name}
                                    className={cn(
                                      "grid min-w-0 cursor-pointer gap-3 border-t p-3 transition-colors first:border-t-0 xl:items-center",
                                      REFINED_MODULE_COLUMNS,
                                      moduleSelected
                                        ? "bg-selected"
                                        : "hover:bg-hover",
                                    )}
                                    onClick={(event) => toggleModuleFromRow(event, module.name)}
                                  >
                                    <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                                      <Checkbox
                                        className="mt-1"
                                        aria-label={`Sélectionner ${module.name}`}
                                        checked={moduleSelected}
                                        onCheckedChange={(checked) => toggleModuleSelection(module.name, checked === true)}
                                      />
                                      <span className="min-w-0">
                                        <span
                                          className={cn(
                                            "block",
                                            showTechnicalName ? cn("break-words", REFINED_ROW_TITLE) : cn("break-all", REFINED_IDENTIFIER),
                                          )}
                                        >
                                          {moduleTitle}
                                        </span>
                                        {showTechnicalName && (
                                          <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">{module.name}</span>
                                        )}
                                        {showModuleLocations && (
                                          <span className="mt-1.5 block space-y-0.5 text-xs">
                                            {module.path_kind && <span className="block text-muted-foreground">{module.path_kind}</span>}
                                            <span className="block truncate font-mono text-teal-700 dark:text-teal-300" title={sourcePath}>
                                              {displaySourcePath || "-"}
                                            </span>
                                            {displayLinkPath && !samePaths && (
                                              <span className="block truncate font-mono text-blue-700 dark:text-blue-300" title={linkPath}>
                                                {displayLinkPath}
                                              </span>
                                            )}
                                          </span>
                                        )}
                                      </span>
                                    </label>
                                    <div className="flex min-w-0 items-center justify-between gap-3 xl:block">
                                      <span className="text-xs font-medium text-muted-foreground xl:hidden">État</span>
                                      <ModuleStateBadge state={module.state} />
                                    </div>
                                    <div className="flex min-w-0 items-start justify-between gap-3 xl:block">
                                      <span className="text-xs font-medium text-muted-foreground xl:hidden">Version</span>
                                      <span className="min-w-0 break-all font-mono text-xs tabular-nums">
                                        {module.installed_version || module.version || "-"}
                                      </span>
                                    </div>
                                    <div className="flex min-w-0 items-center justify-between gap-3 xl:block">
                                      <span className="text-xs font-medium text-muted-foreground xl:hidden">Origine</span>
                                      <Badge className="shrink-0" variant="outline">{moduleOriginLabel(origin)}</Badge>
                                    </div>
                                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                                      {module.state === "installed" ? (
                                        <Button
                                          className="w-full"
                                          size="sm"
                                          variant="accent"
                                          disabled={!canUseDb}
                                          onClick={() => createJob("update_module", { project: selectedProject?.name, db: selectedDb, modules: module.name })}
                                        >
                                          <RefreshCcw className="h-4 w-4" />
                                          Mettre à jour
                                        </Button>
                                      ) : (
                                        <Button
                                          className="w-full"
                                          size="sm"
                                          variant="success"
                                          disabled={!canUseDb}
                                          onClick={() => createJob("install_module", { project: selectedProject?.name, db: selectedDb, modules: module.name })}
                                        >
                                          <PlusCircle className="h-4 w-4" />
                                          Installer
                                        </Button>
                                      )}
                                      <DropdownMenu.Root modal={false}>
                                        <DropdownMenu.Trigger>
                                          <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" title={`Autres actions pour ${module.name}`} aria-label={`Autres actions pour ${module.name}`}>
                                            <MoreHorizontal className="h-4 w-4" />
                                          </Button>
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Content align="end" className="min-w-52">
                                          <DropdownMenu.Label>Actions sur {module.name}</DropdownMenu.Label>
                                          {module.state === "installed" && (
                                            <DropdownMenu.Item disabled={!canUseDb} onSelect={() => requestTranslationReset([module.name])}>
                                              <Languages className="h-4 w-4" />
                                              Réinitialiser les traductions
                                            </DropdownMenu.Item>
                                          )}
                                          {module.state === "installed" && (
                                            <DropdownMenu.Item color="red" disabled={!canUseDb} onSelect={() => requestUninstall([module.name])}>
                                              <PackageX className="h-4 w-4" />
                                              Désinstaller de la base
                                            </DropdownMenu.Item>
                                          )}
                                          {module.removal_mode !== "link_only" && (
                                            <DropdownMenu.Item color="red" disabled={!module.removable} onSelect={() => requestDeleteCode([module.name])}>
                                              <Trash2 className="h-4 w-4" />
                                              Supprimer du projet
                                            </DropdownMenu.Item>
                                          )}
                                          {module.state !== "installed" && module.removal_mode === "link_only" && (
                                            <DropdownMenu.Item disabled>Module protégé</DropdownMenu.Item>
                                          )}
                                        </DropdownMenu.Content>
                                      </DropdownMenu.Root>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              moduleEmptyState
                            )}
                          </div>
                          {modulePaginationBlock}
                        </RefinedPanel>
                      </div>
                    ) : (
                    <Card>
                      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <CardTitle>Modules</CardTitle>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => void refreshModules()}
                              disabled={loadingModules}
                              aria-label="Actualiser la liste des modules"
                              title="Actualiser la liste des modules"
                            >
                              <RefreshCcw className={cn("h-4 w-4", loadingModules && "animate-spin")} />
                            </Button>
                          </div>
                          <CardDescription>Recherche, sélection et mise à jour des modules de la base Odoo choisie.</CardDescription>
                        </div>
                        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
                          <Button
                            className="w-full"
                            variant="outline"
                            onClick={openSocleDialog}
                            disabled={!selectedProjectReady || loading}
                          >
                            <Boxes className="h-4 w-4" />
                            Installer un socle
                          </Button>
                          <Button
                            className="w-full"
                            disabled={!selectedProjectReady || loading || checkingUpdatePrerequisites}
                            onClick={requestUpdateAllOdooModules}
                          >
                            {checkingUpdatePrerequisites ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                            MAJ complète Odoo
                          </Button>
                          <Button className="w-full" variant="outline" onClick={() => setRepositoryOpen(true)} disabled={!selectedProjectReady || loading}>
                            <CloudDownload className="h-4 w-4" />
                            Dépôt SSH · Ajout / MAJ
                          </Button>
                          <Button className="w-full" variant="outline" onClick={() => setZipDialogOpen(true)} disabled={!selectedProjectReady}>
                            <FileArchive className="h-4 w-4" />
                            Ajouter un pauvre zip
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-4">{moduleFiltersBlock}</div>
                        <div className="mb-3 space-y-3">{moduleSelectionBlock}</div>
                        <div className="overflow-hidden rounded-md border">
                          <div className={cn("hidden border-b bg-muted px-3 py-2 text-xs font-medium uppercase text-muted-foreground xl:grid xl:items-center xl:gap-3", moduleTableGridColumns)}>
                            <div>Module</div>
                            <div>État</div>
                            <div>Version</div>
                            <div>Origine</div>
                            {showModuleLocations && <div>Emplacements</div>}
                            <div className="text-right">Actions</div>
                          </div>
                          <div className="max-h-[min(62vh,720px)] min-w-0 overflow-y-auto">
                            {visibleModules.length ? (
                              visibleModules.map((module) => {
                                const sourcePath = module.source_path || module.path;
                                const linkPath = module.link_path || (module.path_kind?.startsWith("lien") ? module.path : "");
                                const displaySourcePath = compactWorkspacePath(sourcePath, overview?.workspace);
                                const displayLinkPath = compactWorkspacePath(linkPath, overview?.workspace);
                                const samePaths = Boolean(linkPath && sourcePath && linkPath === sourcePath);
                                const origin = normalizedModuleOrigin(module.origin, sourcePath);
                                return (
                                  <div
                                    key={module.name}
                                    className={cn(
                                      "grid min-w-0 cursor-pointer gap-3 border-t p-3 transition-colors first:border-t-0 hover:bg-hover xl:items-center",
                                      moduleTableGridColumns,
                                      selectedModules.has(module.name) && "bg-selected",
                                    )}
                                    onClick={(event) => toggleModuleFromRow(event, module.name)}
                                  >
                                    <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                                      <Checkbox
                                        className="mt-1"
                                        aria-label={`Sélectionner ${module.name}`}
                                        checked={selectedModules.has(module.name)}
                                        onCheckedChange={(checked) => toggleModuleSelection(module.name, checked === true)}
                                      />
                                      <span className="min-w-0">
                                        <div className="break-words font-medium">{module.name}</div>
                                        <div className="mt-0.5 break-words text-xs text-muted-foreground">{module.title || module.name}</div>
                                      </span>
                                    </label>
                                    <div className="flex min-w-0 items-center justify-between gap-3 xl:block">
                                      <span className="text-xs font-medium text-muted-foreground xl:hidden">État</span>
                                      <ModuleStateBadge state={module.state} />
                                    </div>
                                    <div className="flex min-w-0 items-start justify-between gap-3 text-sm xl:block">
                                      <span className="text-xs font-medium text-muted-foreground xl:hidden">Version</span>
                                      <span className="min-w-0 break-words">{module.installed_version || module.version || "-"}</span>
                                    </div>
                                    <div className="flex min-w-0 items-center justify-between gap-3 xl:block">
                                      <span className="text-xs font-medium text-muted-foreground xl:hidden">Origine</span>
                                      <Badge className="shrink-0" variant="outline">{moduleOriginLabel(origin)}</Badge>
                                    </div>
                                    {showModuleLocations && (
                                      <div className="min-w-0">
                                        <div className="mb-1 text-xs font-medium text-muted-foreground xl:hidden">Emplacements</div>
                                        <div className="space-y-1">
                                          {module.path_kind && (
                                            <Badge className="w-fit max-w-full truncate" variant="outline" title={module.path_kind}>
                                              {module.path_kind}
                                            </Badge>
                                          )}
                                          <div className="min-w-0 text-xs">
                                            <span className="font-medium text-teal-700 dark:text-teal-300">Source</span>
                                            <div className="truncate font-mono text-teal-800 dark:text-teal-200" title={sourcePath}>
                                              {displaySourcePath || "-"}
                                            </div>
                                          </div>
                                          {displayLinkPath && !samePaths && (
                                            <div className="min-w-0 text-xs">
                                              <span className="font-medium text-blue-700 dark:text-blue-300">Lien Odoo</span>
                                              <div className="truncate font-mono text-blue-800 dark:text-blue-200" title={linkPath}>
                                                {displayLinkPath}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_40px] gap-2">
                                      {module.state === "installed" ? (
                                        <Button
                                          className="w-full"
                                          size="sm"
                                          variant="accent"
                                          disabled={!canUseDb}
                                          onClick={() => createJob("update_module", { project: selectedProject?.name, db: selectedDb, modules: module.name })}
                                        >
                                          <RefreshCcw className="h-4 w-4" />
                                          Mettre à jour
                                        </Button>
                                      ) : (
                                        <Button
                                          className="w-full"
                                          size="sm"
                                          variant="success"
                                          disabled={!canUseDb}
                                          onClick={() => createJob("install_module", { project: selectedProject?.name, db: selectedDb, modules: module.name })}
                                        >
                                          <PlusCircle className="h-4 w-4" />
                                          Installer
                                        </Button>
                                      )}
                                      <DropdownMenu.Root modal={false}>
                                        <DropdownMenu.Trigger>
                                          <Button size="icon" variant="outline" title={`Autres actions pour ${module.name}`} aria-label={`Autres actions pour ${module.name}`}>
                                            <MoreHorizontal className="h-4 w-4" />
                                          </Button>
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Content align="end" className="min-w-52">
                                          <DropdownMenu.Label>Actions sur {module.name}</DropdownMenu.Label>
                                          {module.state === "installed" && (
                                            <DropdownMenu.Item disabled={!canUseDb} onSelect={() => requestTranslationReset([module.name])}>
                                              <Languages className="h-4 w-4" />
                                              Réinitialiser les traductions
                                            </DropdownMenu.Item>
                                          )}
                                          {module.state === "installed" && (
                                            <DropdownMenu.Item color="red" disabled={!canUseDb} onSelect={() => requestUninstall([module.name])}>
                                              <PackageX className="h-4 w-4" />
                                              Désinstaller de la base
                                            </DropdownMenu.Item>
                                          )}
                                          {module.removal_mode !== "link_only" && (
                                            <DropdownMenu.Item color="red" disabled={!module.removable} onSelect={() => requestDeleteCode([module.name])}>
                                              <Trash2 className="h-4 w-4" />
                                              Supprimer du projet
                                            </DropdownMenu.Item>
                                          )}
                                          {module.state !== "installed" && module.removal_mode === "link_only" && (
                                            <DropdownMenu.Item disabled>Module protégé</DropdownMenu.Item>
                                          )}
                                        </DropdownMenu.Content>
                                      </DropdownMenu.Root>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              moduleEmptyState
                            )}
                          </div>
                          {modulePaginationBlock}
                        </div>
                      </CardContent>
                    </Card>
                    )}
                  </TabsContent>
                )}

                <ActivityTab
                  enableLogAutoFollow={enableLogAutoFollow}
                  logAutoFollow={logAutoFollow}
                  logDescriptionExpanded={logDescriptionExpanded}
                  logOutputRef={logOutputRef}
                  logStreamFirstLineRef={logStreamFirstLineRef}
                  logStreamRef={logStreamRef}
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
            pushToast("success", "Environnement Linux prêt. Redémarre l’application une fois les actions en cours terminées.");
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
          if (job && selectedProject) droppedDatabase.current = { jobId: job.id, project: selectedProject.name, db: selectedDb };
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
          {moduleSelectionBar(true)}
        </div>
      )}

      <div className={cn("fixed bottom-4 left-4 right-4 z-50 grid gap-2 sm:left-auto sm:w-96", showFloatingModuleActions && "bottom-28 xl:bottom-20")}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "w-full whitespace-pre-line break-words rounded-md border bg-card p-3 text-sm shadow-lg",
              toast.kind === "error" && "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
              toast.kind === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </main>
  );
}
