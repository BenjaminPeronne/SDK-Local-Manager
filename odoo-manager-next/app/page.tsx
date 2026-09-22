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
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CloudDownload,
  Copy,
  Database,
  ExternalLink,
  FileArchive,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Heart,
  Info,
  KeyRound,
  Languages,
  Loader2,
  Logs,
  MoreHorizontal,
  PackageX,
  Paintbrush,
  Play,
  PlusCircle,
  RefreshCcw,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Upload,
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
  pickDirectory,
  requestTaskNotificationPermission,
  sendTaskNotification,
} from "@/lib/desktop-runtime";
import { compactWorkspacePath, normalizeSearchText, statusLabel, statusVariant } from "@/lib/format";
import { type JobOutputCache, mergeIncrementalJobOutput } from "@/lib/job-output";
import {
  isJobActive,
  isJobUnfinished,
  jobCompletionTitle,
  jobsFingerprint,
  jobStopUnavailableReason,
  MIGRATION_JOB_PREFIX,
  PROJECT_ARRIVAL_PREFIXES,
} from "@/lib/jobs";
import { moduleOriginLabel, moduleRepositoryUrlError, normalizedModuleOrigin, socleAppInstalled } from "@/lib/modules";
import {
  fallbackManagerSettings,
  firstOdooDatabase,
  formatDiagnostics,
  odooAccessUrl,
  offlineDockerGuide,
} from "@/lib/projects";
import type {
  AddonLinksStatus,
  BackendDiagnostics,
  BootstrapSnapshot,
  DatabaseMenuAction,
  FilestoreStatus,
  Job,
  ManagerErrorEntry,
  ManagerSettings,
  MigrationSnapshot,
  ModuleInfo,
  Overview,
  PendingModuleOperation,
  Project,
  ProjectCreationPrerequisites,
  ProjectDiagnostics,
  RepositoryInspection,
  RepositoryModule,
  RestoreDatabasePayload,
  SocleCatalog,
  SocleInstallPlan,
  SshPublicKey,
  SystemStatus,
  Toast,
  ZipInspection,
} from "@/lib/types";
import { cn, delay } from "@/lib/utils";
import { isWslSetupPending } from "@/lib/wsl-setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, InteractiveCard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/common/notice";
import {
  REFINED_FOCUS_RING,
  REFINED_IDENTIFIER,
  REFINED_LABEL,
  REFINED_MODULE_COLUMNS,
  REFINED_ROW_TITLE,
  RefinedPanel,
  RefinedRow,
  RefinedSectionHeader,
} from "@/components/common/refined-layout";
import { CreateDatabaseDialog } from "@/components/databases/create-database-dialog";
import { DropDatabaseDialog } from "@/components/databases/drop-database-dialog";
import { FirstDatabaseCallout } from "@/components/databases/first-database-callout";
import { RestoreDatabaseDialog } from "@/components/databases/restore-database-dialog";
import {
  defaultRepositorySource,
  GitLabRepositoryPicker,
  type RepositorySource,
  RepositorySourceToggle,
} from "@/components/gitlab-repository-picker";
import { JobCancelState, JobProgressPanel, JobStopButton } from "@/components/jobs/job-controls";
import { JobOutputPre, OdooLogsModeBar } from "@/components/jobs/job-output";
import {
  ModuleStateBadge,
  PlanModuleChips,
  RepositoryModuleStatus,
  RepositoryModuleVersion,
} from "@/components/modules/module-badges";
import { CreateProjectDialog, PrerequisiteRow } from "@/components/projects/create-project-dialog";
import { MigrationProposal } from "@/components/projects/migration-proposal";
import {
  SETTINGS_SAVED_KEYS,
  SETTINGS_SECTIONS,
  SettingsGroup,
  SettingsSection,
  type SettingsSectionId,
} from "@/components/settings/settings-section";
import { ThemeToggle } from "@/components/theme-toggle";
import { WelcomeScreen } from "@/components/welcome/welcome-screen";
import { WslSetupDialog } from "@/components/wsl-setup";
import appIcon from "./icon.png";
import localIcon from "./local-icon.png";

// Au-delà, le rendu des lignes ralentit la fenêtre (dépôts complets de 1 500 modules) : on filtre.
const REPOSITORY_PICKER_MAX_ROWS = 200;

const GITLAB_TOKEN_URL = "https://gitlab.sudokeys.com/-/user_settings/personal_access_tokens?name=SDK%20Local%20Manager&scopes=read_api";

const REPOSITORY_ACTION_ORDER = { update: 0, add: 1, blocked: 2 } as const;

// Distance de défilement sur laquelle le bandeau des onglets collés passe de transparent à opaque.
const TABS_BACKDROP_FADE_PX = 96;

const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD || "";

const APP_COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT || "";

const BOOTSTRAP_RETRY_DELAYS_MS = [0, 500, 1000, 2000];

const DOCKER_CONFIRM_DELAY_MS = 700;

const LOG_DESCRIPTION_MAX_LENGTH = 240;

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
  const [generatingSshKey, setGeneratingSshKey] = useState(false);
  const [sshRegenerateMode, setSshRegenerateMode] = useState(false);
  const [sshRegenerateConfirmed, setSshRegenerateConfirmed] = useState(false);
  const [sshKeyBackup, setSshKeyBackup] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [selectingWorkspace, setSelectingWorkspace] = useState(false);
  const [projectsFilter, setProjectsFilter] = useState("");
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
  const [loadingSoclePlan, setLoadingSoclePlan] = useState(false);
  const [soclePlanError, setSoclePlanError] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobOutputCache = useRef<JobOutputCache>(new Map());
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [logDescriptionExpanded, setLogDescriptionExpanded] = useState(false);
  const [externalLogView, setExternalLogView] = useState<{ title: string; content: string; project: string; logs?: "summary" | "full" } | null>(null);
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
  const [repositorySubmitting, setRepositorySubmitting] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryBranch, setRepositoryBranch] = useState("");
  const [repositoryInspection, setRepositoryInspection] = useState<RepositoryInspection>({ status: "idle" });
  const [repositorySelection, setRepositorySelection] = useState<Set<string>>(new Set());
  const [repositoryFilter, setRepositoryFilter] = useState("");
  const [repositoryInspectionAttempt, setRepositoryInspectionAttempt] = useState(0);
  const [gitlabStatus, setGitlabStatus] = useState<GitLabStatus | null>(null);
  const [gitlabTokenDraft, setGitlabTokenDraft] = useState("");
  const [gitlabConnecting, setGitlabConnecting] = useState(false);
  const [repositorySource, setRepositorySource] = useState<RepositorySource>("ssh");
  const repositoryUrlError = moduleRepositoryUrlError(repositoryUrl);
  const [zipDialogOpen, setZipDialogOpen] = useState(false);
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [restoreDbOpen, setRestoreDbOpen] = useState(false);
  const [neutralizeDbOpen, setNeutralizeDbOpen] = useState(false);
  const [dropDbOpen, setDropDbOpen] = useState(false);
  const [pendingDatabaseAction, setPendingDatabaseAction] = useState<{ db: string; action: DatabaseMenuAction } | null>(null);
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
  const [adminPassword, setAdminPassword] = useState("admin");
  const [deleteCodeDialogOpen, setDeleteCodeDialogOpen] = useState(false);
  const [replaceZipModules, setReplaceZipModules] = useState(true);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipModuleCandidates, setZipModuleCandidates] = useState<string[]>([]);
  const [selectedZipModules, setSelectedZipModules] = useState<Set<string>>(new Set());
  const [inspectingZip, setInspectingZip] = useState(false);
  const [deleteCodeUninstallFirst, setDeleteCodeUninstallFirst] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [pendingUninstallModules, setPendingUninstallModules] = useState<string[]>([]);
  const [jobToCancelId, setJobToCancelId] = useState<number | null>(null);
  const [pendingDeleteCodeModules, setPendingDeleteCodeModules] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("bases");
  const [pendingCreatedProjectName, setPendingCreatedProjectName] = useState("");
  const [pendingCreatedDatabase, setPendingCreatedDatabase] = useState<{ jobId: number; project: string; database: string } | null>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
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
  const zipInspectionGeneration = useRef(0);
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

  const handleLogOutputScroll = useCallback(() => {
    const output = logOutputRef.current;
    if (!output) return;
    const distanceFromBottom = output.scrollHeight - output.scrollTop - output.clientHeight;
    logAutoFollow.current = distanceFromBottom <= 48;
  }, []);

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
  const pendingSelectedArrivalIsMigration = Boolean(pendingSelectedProjectArrival?.title.startsWith(MIGRATION_JOB_PREFIX));
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
  const projectLifecycleJobs = useMemo(() => {
    const runningJobs = new Map<string, Job>();
    for (const job of jobs) {
      if (isJobActive(job)) runningJobs.set(job.title, job);
    }
    return runningJobs;
  }, [jobs]);
  const gitInstallRunning = jobs.some((job) => isJobUnfinished(job) && job.title === "Installer Git pour Windows");
  const traefikInstallRunning = jobs.some((job) => isJobUnfinished(job) && job.title === "Installer Traefik");
  const selectedSshKey = useMemo(
    () => sshKeys.find((key) => key.name === selectedSshKeyName) || sshKeys[0] || null,
    [selectedSshKeyName, sshKeys],
  );

  const filteredProjects = useMemo(() => {
    const query = projectsFilter.trim().toLowerCase();
    return (overview?.projects || [])
      .filter((project) => !query || project.name.toLowerCase().includes(query))
      .map((project, index) => ({ project, index }))
      .sort((left, right) => {
        const rank = (project: Project) => {
          if (project.odoo_status === "running") return 0;
          if (project.odoo_status === "absent" || project.odoo_status === "docker off") return 2;
          return 1;
        };
        return rank(left.project) - rank(right.project) || left.index - right.index;
      })
      .map(({ project }) => project);
  }, [overview, projectsFilter]);

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
  const visibleSocleApps = useMemo(() => {
    const query = normalizeSearchText(socleSearch.trim());
    const apps = socleCatalog?.apps ?? [];
    if (!query) return apps;
    return apps.filter((app) => normalizeSearchText(`${app.label} ${app.modules.join(" ")}`).includes(query));
  }, [socleCatalog, socleSearch]);
  const soclePlanBlocked = Boolean(soclePlan && (soclePlan.missing.length || soclePlan.uninstallable.length));
  const pendingModulesWithMissingCode = useMemo(
    () => updatePendingModules.filter((module) => !module.code_available),
    [updatePendingModules],
  );
  const pendingModulesWithAvailableCode = useMemo(
    () => updatePendingModules.filter((module) => module.code_available),
    [updatePendingModules],
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
  const allMissingPendingModulesSelected =
    pendingModulesWithMissingCode.length > 0 &&
    pendingModulesWithMissingCode.every((module) => missingModulesToIgnore.has(module.name));
  const someMissingPendingModulesSelected =
    pendingModulesWithMissingCode.some((module) => missingModulesToIgnore.has(module.name)) && !allMissingPendingModulesSelected;
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

  const reopenInitialConfiguration = useCallback(() => {
    setSettingsOpen(false);
    setOnboardingOpen(true);
    void loadCreationPrerequisites();
  }, [loadCreationPrerequisites]);

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

  function toggleSoclePreset(presetId: string, checked: boolean) {
    setSelectedSoclePresets((current) => {
      const next = new Set(current);
      if (checked) next.add(presetId);
      else next.delete(presetId);
      return next;
    });
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

  async function installSelectedSocle() {
    if (!selectedProject || !selectedDb || !soclePresetsToInstall.length || soclePlanBlocked) return;
    const job = await createJob("install_socle", {
      project: selectedProject.name,
      db: selectedDb,
      presets: soclePresetsToInstall.join(","),
    });
    if (job) {
      setSocleDialogOpen(false);
      setActiveTab("logs");
      schedule(refreshModules, 2500);
    }
  }

  async function convertWslAddonLinks() {
    if (!selectedProject) return;
    const job = await createJob("convert_wsl_addon_links", { project: selectedProject.name });
    if (job) setActiveTab("logs");
  }

  async function repairEnterpriseLinks() {
    if (!selectedProject) return;
    const job = await createJob("repair_enterprise_links", { project: selectedProject.name });
    if (job) {
      setSocleDialogOpen(false);
      setActiveTab("logs");
      schedule(refreshModules, 1500);
    }
  }

  async function waitForJob(jobId: number, timeoutMilliseconds = 960000) {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      const payload = await api<{ jobs: Job[] }>("/api/jobs");
      applyJobs(payload.jobs);
      const current = payload.jobs.find((job) => job.id === jobId);
      if (!current) throw new Error("L'action de démarrage est introuvable dans l'historique.");
      if (current.status === "done") return current;
      if (current.status === "error") {
        const detail = current.lines.filter(Boolean).at(-1) || "Le projet n'a pas pu démarrer.";
        throw new Error(detail);
      }
      await delay(800);
    }
    throw new Error("Le démarrage d'Odoo prend trop de temps. Consulte les logs de l'action.");
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

  // La clé GitLab déjà déclarée reste côté Windows : sans elle, l'environnement Linux ne clone rien.
  async function requestSshKeyImport() {
    try {
      const result = await desktopBridge()?.wslImportSshKey?.();
      pushToast(
        "success",
        result?.alreadyPresent
          ? `La clé ${result.key} est déjà en place dans l’environnement Linux.`
          : `Clé ${result?.key || "SSH"} copiée dans l’environnement Linux.`,
      );
    } catch (err) {
      pushToast("error", desktopErrorMessage(err, "Impossible de copier la clé SSH."));
    } finally {
      // L'assistant a pu être ouvert avant un autre changement : son état est relu dans tous les cas.
      await loadCreationPrerequisites();
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

  async function requestGitInstall() {
    if (gitInstallRunning) return;
    const job = await createJob("install_git");
    if (!job) return;
    const refreshPrerequisites = async () => { await loadCreationPrerequisites(); };
    schedule(refreshPrerequisites, 3000);
    schedule(refreshPrerequisites, 10000);
    schedule(refreshPrerequisites, 25000);
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

  async function copyManagerErrors() {
    const content = managerErrors.map((entry) => [
      `[${entry.timestamp}] ${entry.source}${entry.project ? ` · ${entry.project}` : ""}`,
      entry.message,
      entry.details || "",
    ].filter(Boolean).join("\n")).join("\n\n");
    try {
      await navigator.clipboard.writeText(content);
      pushToast("success", "Journal d’erreurs copié.");
    } catch {
      pushToast("error", "Impossible de copier le journal d’erreurs.");
    }
  }

  async function clearManagerErrors() {
    try {
      await api<{ ok: boolean }>("/api/errors", { method: "DELETE" });
      setManagerErrors([]);
      pushToast("success", "Journal d’erreurs effacé.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible d’effacer le journal d’erreurs.");
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

  async function requestSshKeyGeneration(replace = false) {
    setGeneratingSshKey(true);
    try {
      const key = await api<SshPublicKey & { created: boolean; message: string; backup?: string }>("/api/system/ssh-key/generate", {
        method: "POST",
        body: JSON.stringify({ comment: sshComment, replace }),
      });
      pushToast("success", key.message);
      setSshRegenerateMode(false);
      setSshRegenerateConfirmed(false);
      setSshKeyBackup(key.backup || "");
      await loadSshKeys();
      setSelectedSshKeyName(key.name);
      await loadCreationPrerequisites();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible de générer la clé SSH.");
    } finally {
      setGeneratingSshKey(false);
    }
  }

  async function copySshPublicKey() {
    const key = sshKeys.find((item) => item.name === selectedSshKeyName);
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key.public_key);
      pushToast("success", "Clé publique copiée.");
    } catch {
      pushToast("error", "Impossible de copier la clé publique.");
    }
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

  async function submitRepositoryModules() {
    if (!selectedProject || repositorySubmitting) return;
    setRepositorySubmitting(true);
    try {
      const job = await createJob("repository_modules", {
        project: selectedProject.name,
        url: repositoryUrl.trim(),
        branch: repositoryBranch.trim(),
        modules: repositorySelectedModules.map((module) => module.name).join(","),
        // Le serveur refuse l'import si la branche a bougé depuis l'aperçu validé ici.
        commit: repositoryInspection.status === "ready" ? repositoryInspection.commit : "",
      });
      if (!job) return;
      setRepositoryOpen(false);
      setActiveTab("logs");
    } finally {
      setRepositorySubmitting(false);
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    const apiPortChanged = settings?.api_port !== settingsDraft.api_port;
    setSavingSettings(true);
    try {
      const payload = await api<{ settings: ManagerSettings }>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ ...settingsDraft, execution_mode: "native", create_workspace: true }),
      });
      // Réafficher la proposition depuis les réglages la ramène tout de suite, sans attendre
      // le redémarrage que demande la simple fermeture du bandeau.
      if (settings?.migration_banner_dismissed && !payload.settings.migration_banner_dismissed) {
        setMigrationBannerClosed(false);
      }
      setSettings(payload.settings);
      setSettingsDraft(payload.settings);
      setSettingsOpen(false);
      setSelectedProjectName("");
      setSelectedDb("");
      setModules([]);
      pushToast("success", apiPortChanged ? "Paramètres enregistrés. Redémarre le gestionnaire pour appliquer le nouveau port." : "Paramètres enregistrés.");
      await Promise.all([refreshOverview(), refreshSystemStatus(), refreshMigration()]);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function selectWorkspaceDirectory() {
    if (!settingsDraft || !desktopRuntime) return;
    setSelectingWorkspace(true);
    try {
      const selected = await pickDirectory(settingsDraft.workspace);
      if (selected) {
        setSettingsDraft({ ...settingsDraft, workspace: selected });
      }
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible d’ouvrir le sélecteur de dossier.");
    } finally {
      setSelectingWorkspace(false);
    }
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

  function toggleMissingModuleToIgnore(moduleName: string, checked: boolean) {
    setMissingModulesToIgnore((current) => {
      const next = new Set(current);
      if (checked) next.add(moduleName);
      else next.delete(moduleName);
      return next;
    });
  }

  function toggleAllMissingModulesToIgnore(checked: boolean) {
    setMissingModulesToIgnore(checked ? new Set(pendingModulesWithMissingCode.map((module) => module.name)) : new Set());
  }

  async function ignoreSelectedMissingModulesLocally() {
    const db = selectedDatabaseOrNotify("l'annulation locale des opérations module");
    if (!db || !selectedProject || !missingModulesToIgnore.size) return;
    const modulesToIgnore = Array.from(missingModulesToIgnore).sort();
    const job = await createJob("ignore_missing_modules_locally", {
      project: selectedProject.name,
      db,
      modules: modulesToIgnore.join(","),
    });
    if (job) {
      setUpdateAllDialogOpen(false);
      try {
        await waitForJob(job.id);
        pushToast("success", "Les opérations locales ont été annulées. Le précontrôle est actualisé.");
        await refreshModules();
        await requestUpdateAllOdooModules();
      } catch (err) {
        pushToast("error", err instanceof Error ? err.message : "Impossible d’actualiser le précontrôle.");
        setActiveTab("logs");
      }
    }
  }

  async function restoreLocalModuleExclusions() {
    const db = selectedDatabaseOrNotify("la réactivation des mises à jour module");
    if (!db || !selectedProject || !updateLocalExcludedModules.length) return;
    const job = await createJob("restore_module_update_exclusions", {
      project: selectedProject.name,
      db,
      modules: updateLocalExcludedModules.join(","),
    });
    if (job) {
      setUpdateAllDialogOpen(false);
      schedule(refreshModules, 1500);
    }
  }

  async function confirmUpdateAllOdooModules() {
    const db = selectedDatabaseOrNotify("la MAJ complète Odoo");
    if (!db || !selectedProject) return;
    const targeted = updateScope === "imported" && detectedImportedModules.length > 0;
    const job = await createJob(
      targeted ? "update_imported_modules" : "update_all_modules",
      targeted
        ? { project: selectedProject.name, db, modules: detectedImportedModules.join(",") }
        : { project: selectedProject.name, db, allow_missing_filestore: allowMissingFilestore },
    );
    if (job) {
      setUpdateAllDialogOpen(false);
      schedule(refreshModules, 2500);
    }
  }

  async function refreshAllViews() {
    await Promise.all([refreshOverview(), refreshSystemStatus(), refreshJobs()]);
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(outputContent);
      pushToast("success", "Sortie copiée.");
    } catch {
      pushToast("error", "Impossible de copier la sortie.");
    }
  }

  function showLogs(raw = false) {
    if (!selectedProject) return;
    const projectName = selectedProject.name;
    stopLiveLogStream();
    logStreamFirstLineRef.current = true;
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
    const source = new EventSource(`${API_BASE}/api/projects/${encodeURIComponent(projectName)}/logs/stream${raw ? "?raw=1" : ""}`);
    logStreamRef.current = source;
    source.addEventListener("log", (event) => {
      let line = "";
      try {
        line = (JSON.parse((event as MessageEvent<string>).data) as { line?: string }).line || "";
      } catch {
        return;
      }
      setExternalLogView((current) => {
        if (!current || current.project !== projectName) return current;
        const content = logStreamFirstLineRef.current ? line : `${current.content}\n${line}`;
        logStreamFirstLineRef.current = false;
        return { ...current, content };
      });
    });
    source.addEventListener("log_end", () => {
      if (logStreamRef.current === source) stopLiveLogStream();
    });
    source.onerror = () => {
      if (logStreamRef.current === source) pushToast("error", "Flux de logs interrompu, nouvelle tentative en cours…");
    };
  }

  async function showDiagnostics() {
    if (!selectedProject) return;
    stopLiveLogStream();
    try {
      const payload = await api<ProjectDiagnostics>(`/api/projects/${encodeURIComponent(selectedProject.name)}/diagnostics`);
      setExternalLogView({
        title: `Diagnostic - ${selectedProject.name}`,
        content: formatDiagnostics(payload),
        project: selectedProject.name,
      });
      enableLogAutoFollow();
      pushToast("info", "Diagnostic projet chargé.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Diagnostic indisponible.");
    }
  }

  async function clearJobs() {
    stopLiveLogStream();
    try {
      await api<{ ok: boolean }>("/api/jobs", { method: "DELETE" });
      setSelectedJobId(null);
      setExternalLogView(null);
      await refreshJobs();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Suppression de l'historique impossible.");
    }
  }

  async function confirmCancelJob() {
    const job = jobs.find((item) => item.id === jobToCancelId);
    setJobToCancelId(null);
    if (!job) return;
    try {
      const result = await api<{ job: Job }>(`/api/jobs/${job.id}/cancel`, { method: "POST", body: "{}" });
      pushToast(
        "info",
        result.job.status === "cancelled" ? `Action retirée de la file d'attente : ${job.title}` : `Arrêt demandé : ${job.title}`,
      );
      await refreshJobs(job.id);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Arrêt de l'action impossible.");
      void refreshJobs(job.id);
    }
  }

  async function deleteJob(jobId: number) {
    try {
      await api<{ ok: boolean }>(`/api/jobs/${jobId}`, { method: "DELETE" });
      if (selectedJobId === jobId) {
        stopLiveLogStream();
        setSelectedJobId(null);
        setExternalLogView(null);
      }
      await refreshJobs();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Suppression de l'entrée impossible.");
    }
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

  async function confirmUninstall() {
    if (!selectedProject || !selectedDb || !pendingUninstallModules.length) return;
    const job = await createJob("uninstall_module", {
      project: selectedProject.name,
      db: selectedDb,
      modules: pendingUninstallModules.join(","),
    });
    if (job) {
      setUninstallDialogOpen(false);
      setPendingUninstallModules([]);
      setSelectedModules(new Set());
      schedule(refreshModules, 2500);
    }
  }

  function requestTranslationReset(moduleNames: string[]) {
    const installed = moduleNames.filter((name) => modules.find((module) => module.name === name)?.state === "installed");
    if (!installed.length) {
      pushToast("error", "Sélectionne au moins un module installé.");
      return;
    }
    setPendingTranslationResetModules(installed);
  }

  async function confirmTranslationReset() {
    const db = selectedDatabaseOrNotify("la réinitialisation des traductions");
    if (!db || !selectedProject || !pendingTranslationResetModules.length) return;
    const job = await createJob("reset_module_translations", {
      project: selectedProject.name,
      db,
      modules: pendingTranslationResetModules.join(","),
    });
    if (job) setPendingTranslationResetModules([]);
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

  async function confirmAllTranslationsReset() {
    const db = selectedDatabaseOrNotify("la réinitialisation des traductions");
    if (!db || !selectedProject || !selectedTranslationLanguages.size) return;
    const allSelected = selectedTranslationLanguages.size === translationLanguages?.length;
    const job = await createJob("reset_all_translations", {
      project: selectedProject.name,
      db,
      languages: allSelected ? "" : Array.from(selectedTranslationLanguages).join(","),
    });
    if (job) setAllTranslationsOpen(false);
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

  function runDatabaseAction(db: string, action: DatabaseMenuAction) {
    if (db !== selectedDb) {
      // Les actions lisent la base sélectionnée : on attend que la sélection soit appliquée.
      chooseDatabase(db);
      setPendingDatabaseAction({ db, action });
      return;
    }
    executeDatabaseAction(action);
  }

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

  async function confirmAdminPasswordReset() {
    const db = selectedDatabaseOrNotify("la réinitialisation du mot de passe admin");
    if (!db || !selectedProject || !adminPassword.trim()) return;
    const job = await createJob("reset_admin_password", { project: selectedProject.name, db, password: adminPassword });
    if (job) setAdminPasswordOpen(false);
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

  async function confirmDeleteCode() {
    if (!selectedProject || !pendingDeleteCodeModules.length) return;
    const job = await createJob("delete_module_code", {
      project: selectedProject.name,
      db: deleteCodeUninstallFirst ? selectedDb : "",
      modules: pendingDeleteCodeModules.join(","),
      uninstall_first: deleteCodeUninstallFirst,
    });
    if (job) {
      setDeleteCodeDialogOpen(false);
      setPendingDeleteCodeModules([]);
      setSelectedModules(new Set());
      schedule(refreshModules, 2500);
    }
  }

  async function importZip() {
    if (!selectedProject) return;
    const file = zipInputRef.current?.files?.[0];
    if (!file) {
      pushToast("error", "Sélectionne un fichier ZIP.");
      return;
    }
    const selected = Array.from(selectedZipModules).sort();
    if (!selected.length) {
      pushToast("error", "Sélectionne au moins un module à importer.");
      return;
    }
    const form = new FormData();
    form.append("zip", file);
    form.append("replace_existing", replaceZipModules ? "1" : "0");
    form.append("modules", selected.join(","));
    setLoading(true);
    try {
      const result = await api<{ job: Job }>(`/api/projects/${encodeURIComponent(selectedProject.name)}/module-zip`, {
        method: "POST",
        body: form,
      });
      setSelectedJobId(result.job.id);
      setExternalLogView(null);
      setZipDialogOpen(false);
      resetZipImport();
      pushToast("success", `Import de ${selected.length} module(s) lancé.`);
      schedule(refreshModules, 1800);
      await refreshJobs();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Import ZIP impossible.");
    } finally {
      setLoading(false);
    }
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

  function resetZipImport() {
    zipInspectionGeneration.current += 1;
    setZipFile(null);
    setZipModuleCandidates([]);
    setSelectedZipModules(new Set());
    setInspectingZip(false);
    if (zipInputRef.current) zipInputRef.current.value = "";
  }

  async function inspectZipFile(file?: File) {
    const generation = ++zipInspectionGeneration.current;
    setZipFile(file || null);
    setZipModuleCandidates([]);
    setSelectedZipModules(new Set());
    if (!file || !selectedProject) {
      setInspectingZip(false);
      return;
    }

    const form = new FormData();
    form.append("zip", file);
    setInspectingZip(true);
    try {
      const result = await api<ZipInspection>(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/module-zip/inspect`,
        { method: "POST", body: form },
      );
      if (generation !== zipInspectionGeneration.current) return;
      setZipModuleCandidates(result.modules);
      setSelectedZipModules(new Set(result.modules));
      if (!result.modules.length) {
        pushToast("error", "Aucun module Odoo détecté dans cette archive.");
      } else if (result.ignored_symlinks) {
        pushToast(
          "info",
          `${result.modules.length} module(s) détecté(s). ${result.ignored_symlinks} lien(s) de packaging ignoré(s).`,
        );
      }
    } catch (err) {
      if (generation !== zipInspectionGeneration.current) return;
      pushToast("error", err instanceof Error ? err.message : "Analyse du ZIP impossible.");
    } finally {
      if (generation === zipInspectionGeneration.current) setInspectingZip(false);
    }
  }

  function toggleZipModule(moduleName: string, checked: boolean) {
    setSelectedZipModules((current) => {
      const next = new Set(current);
      if (checked) next.add(moduleName);
      else next.delete(moduleName);
      return next;
    });
  }

  function toggleAllZipModules(checked: boolean) {
    setSelectedZipModules(checked ? new Set(zipModuleCandidates) : new Set());
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
  const selectedProjectHasContainers = Boolean(
    selectedProject &&
    [selectedProject.odoo_status, selectedProject.postgres_status].some((status) => status && status !== "absent" && status !== "docker off"),
  );
  const selectedProjectLifecycleJob = useMemo(
    () =>
      jobs.find(
        (job) =>
          // Une action en attente n'a pas commencé : l'en-tête montre celle qui s'exécute.
          isJobActive(job) &&
          selectedProject &&
          (job.title === `Démarrer ${selectedProject.name}` || job.title === `Arrêter ${selectedProject.name}`),
      ),
    [jobs, selectedProject],
  );
  const selectedProjectStarting = selectedProjectLifecycleJob?.title.startsWith("Démarrer ") ?? false;
  const selectedProjectStopping = selectedProjectLifecycleJob?.title.startsWith("Arrêter ") ?? false;
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
  const repositoryReadyModules = useMemo(
    () =>
      repositoryInspection.status === "ready"
        ? [...repositoryInspection.modules].sort(
            (left, right) => REPOSITORY_ACTION_ORDER[left.action] - REPOSITORY_ACTION_ORDER[right.action] || left.name.localeCompare(right.name),
          )
        : [],
    [repositoryInspection],
  );
  const repositorySelectableModules = repositoryReadyModules.filter((module) => module.action !== "blocked");
  const repositorySelectedModules = repositorySelectableModules.filter((module) => repositorySelection.has(module.name));
  const repositorySelectedAdds = repositorySelectedModules.filter((module) => module.action === "add").length;
  const repositorySelectedUpdates = repositorySelectedModules.length - repositorySelectedAdds;
  const repositoryUpdatableModules = repositorySelectableModules.filter((module) => module.action === "update");
  function repositoryModuleRow(module: RepositoryModule) {
    const blocked = module.action === "blocked";
    const selected = !blocked && repositorySelection.has(module.name);
    const note = module.reason || module.warning;
    const detail = [module.title, module.path !== module.name && module.path !== "." ? module.path : ""].filter(Boolean).join(" · ");
    return (
      <label
        key={`${module.path}:${module.name}`}
        className={cn(
          "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-2.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_9rem_6.5rem] sm:items-center",
          blocked ? "cursor-default" : "cursor-pointer hover:bg-hover",
          selected && "bg-selected",
        )}
      >
        <Checkbox
          className="mt-0.5 sm:mt-0"
          checked={selected}
          disabled={blocked}
          aria-label={`Importer ${module.name}`}
          onCheckedChange={(checked) =>
            setRepositorySelection((current) => {
              const next = new Set(current);
              if (checked === true) next.add(module.name);
              else next.delete(module.name);
              return next;
            })
          }
        />
        <span className="min-w-0">
          <span className={cn("block truncate font-mono text-[13px] font-medium", blocked && "text-muted-foreground")}>{module.name}</span>
          {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
          {note && (
            <span className={cn("mt-0.5 block text-xs", module.reason ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300")}>
              {note}
            </span>
          )}
        </span>
        <span className="col-start-2 sm:col-start-auto sm:text-right">
          <RepositoryModuleVersion module={module} />
        </span>
        <span className="col-start-3 row-start-1 flex justify-end sm:col-start-auto sm:row-start-auto">
          <RepositoryModuleStatus module={module} />
        </span>
      </label>
    );
  }

  const repositoryVisibleModules = useMemo(() => {
    const query = normalizeSearchText(repositoryFilter.trim());
    return query
      ? repositoryReadyModules.filter((module) => normalizeSearchText(`${module.name} ${module.title} ${module.path}`).includes(query))
      : repositoryReadyModules;
  }, [repositoryFilter, repositoryReadyModules]);
  const repositoryVisibleSelectable = repositoryVisibleModules.filter((module) => module.action !== "blocked");
  const repositoryVisibleBlocked = repositoryVisibleModules.filter((module) => module.action === "blocked");

  useEffect(() => {
    if (!repositoryOpen) return;
    setRepositorySource("ssh");
    // Proposition par défaut : la branche qui porte le nom de la version Odoo du projet.
    setRepositoryBranch((current) => current || selectedProject?.odoo_version || "");
    // Compte GitLab connecté : la recherche remplace la saisie d'une URL.
    window.sdkDesktop?.gitlabStatus()
      .then((status) => {
        setGitlabStatus(status);
        setRepositorySource(defaultRepositorySource(status));
      })
      .catch(() => setGitlabStatus(null));
  }, [repositoryOpen]);

  useEffect(() => {
    if (!repositoryOpen) {
      setRepositoryInspection({ status: "idle" });
      setRepositoryFilter("");
      return;
    }
    if (!repositoryInspectionKey || !selectedProject) {
      setRepositoryInspection({ status: "idle" });
      return;
    }
    let cancelled = false;
    // Attend la fin de la saisie : une branche tapée lettre par lettre n'existe pas encore.
    const timer = window.setTimeout(() => {
      setRepositoryInspection({ status: "loading", key: repositoryInspectionKey });
      api<{ modules: RepositoryModule[]; commit: string; odoo_version: string; manifests_read: boolean }>(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/repository/inspect`,
        {
          method: "POST",
          body: JSON.stringify({ url: repositoryUrl.trim(), branch: repositoryBranch.trim(), db: canUseDb ? selectedDb : "" }),
        },
      )
        .then((result) => {
          if (cancelled) return;
          setRepositoryInspection({
            status: "ready",
            key: repositoryInspectionKey,
            modules: result.modules,
            commit: result.commit,
            odooVersion: result.odoo_version,
            manifestsRead: result.manifests_read,
          });
          setRepositorySelection(new Set());
        })
        .catch((err) => {
          if (!cancelled) {
            setRepositoryInspection({
              status: "error",
              key: repositoryInspectionKey,
              error: err instanceof Error ? err.message : "Lecture du dépôt impossible.",
            });
          }
        });
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [repositoryInspectionKey, repositoryOpen, repositoryInspectionAttempt]);
  const soclePlanKey = socleDialogOpen && canUseDb ? soclePresetsToInstall.join(",") : "";

  useEffect(() => {
    if (!soclePlanKey || !selectedProject) {
      setSoclePlan(null);
      setSoclePlanError("");
      setLoadingSoclePlan(false);
      return;
    }
    let cancelled = false;
    setLoadingSoclePlan(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ db: selectedDb, presets: soclePlanKey });
      api<SocleInstallPlan>(`/api/projects/${encodeURIComponent(selectedProject.name)}/socle/plan?${params}`)
        .then((plan) => {
          if (cancelled) return;
          setSoclePlan(plan);
          setSoclePlanError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setSoclePlan(null);
          setSoclePlanError(err instanceof Error ? err.message : "Calcul des dépendances impossible.");
        })
        .finally(() => {
          if (!cancelled) setLoadingSoclePlan(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [soclePlanKey, selectedProject, selectedDb]);
  const selectedOdooUrl = odooAccessUrl(selectedProject, selectedDb);
  const scopedExternalLogView = externalLogView?.project === selectedProject?.name ? externalLogView : null;
  const outputTitle = scopedExternalLogView?.title || selectedJob?.title || "Aucune action sélectionnée";
  const outputContent = scopedExternalLogView?.content || selectedJob?.output || selectedJob?.lines?.join("\n") || "Aucune sortie.";
  const outputSource = scopedExternalLogView ? `external:${scopedExternalLogView.title}` : `job:${selectedJob?.id || "none"}`;
  const outputProgress = !scopedExternalLogView && selectedJob && isJobActive(selectedJob) ? selectedJob.progress : null;
  const outputProgressPercent =
    outputProgress && typeof outputProgress.current === "number" && typeof outputProgress.total === "number" && outputProgress.total > 0
      ? Math.max(0, Math.min(100, Math.round((outputProgress.current / outputProgress.total) * 100)))
      : null;
  const outputTitleIsLong = outputTitle.length > LOG_DESCRIPTION_MAX_LENGTH;
  const displayedOutputTitle = outputTitleIsLong && !logDescriptionExpanded
    ? `${outputTitle.slice(0, LOG_DESCRIPTION_MAX_LENGTH).trimEnd()}…`
    : outputTitle;
  // En mode affiné, un job terminé affiche d'abord son résultat ; la sortie brute se déplie à la demande.
  const finishedJobSummary =
    refinedInterface && !scopedExternalLogView && selectedJob && !isJobUnfinished(selectedJob) ? selectedJob : null;
  const jobToCancel = jobs.find((job) => job.id === jobToCancelId) || null;
  const selectedJobStop =
    !scopedExternalLogView && selectedJob && isJobUnfinished(selectedJob) ? (
      <JobStopButton job={selectedJob} onRequest={setJobToCancelId} />
    ) : null;
  const rawOutputHidden = Boolean(finishedJobSummary) && !rawOutputVisible;

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

  async function requestStartProject() {
    if (!selectedProject) return;
    const job = await createJob("start_project", { project: selectedProject.name });
    if (job) {
      schedule(refreshOverview, 1800);
      schedule(refreshSystemStatus, 2200);
    }
  }

  async function requestStopProject() {
    if (!selectedProject) return;
    const job = await createJob("stop_project", { project: selectedProject.name });
    if (job) {
      schedule(refreshOverview, 1200);
      schedule(refreshSystemStatus, 1600);
    }
  }

  async function requestOpenOdoo() {
    if (!selectedProject || openingOdoo) return;
    setOpeningOdoo(true);
    try {
      const opened = await openExternalUrl(selectedOdooUrl);
      if (!opened) throw new Error("Lien impossible à ouvrir depuis l'application.");
      pushToast("success", "La base Odoo a été ouverte dans le navigateur.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible d'ouvrir Odoo.");
    } finally {
      setOpeningOdoo(false);
    }
  }

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

  const settingsDirty = Boolean(
    settingsDraft && SETTINGS_SAVED_KEYS.some((key) => settingsDraft[key] !== (settings ? settings[key] : undefined)),
  );

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
        <aside className="min-w-0 border-b bg-card lg:sticky lg:top-0 lg:h-screen lg:w-80 lg:flex-none lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="sdk-brand border-b p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <img
                    src={selectedAppIcon.src}
                    alt=""
                    aria-hidden="true"
                    className={cn(
                      "sdk-logo h-10 w-10 shrink-0 object-contain",
                      settings?.interface_icon === "local" ? "rounded-full" : "rounded-[9px]",
                    )}
                  />
                  <div className="min-w-0"><p className="sdk-eyebrow">Sudokeys</p><h1 className="sdk-brand-name text-sm font-extrabold leading-tight">SDK Local Manager</h1></div>
                </div>
                <ThemeToggle />
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={overview?.workspace || "Workspace local"}>
                  {overview?.workspace || "Workspace local"}
                </p>
                <Badge className="shrink-0" variant={(systemStatus?.docker.running ?? overview?.docker_ok) ? "success" : "destructive"}>
                  {(systemStatus?.docker.running ?? overview?.docker_ok) ? "Docker" : "Docker off"}
                </Badge>
              </div>
              <div className="relative mt-4">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Rechercher un projet"
                  value={projectsFilter}
                  onChange={(event) => setProjectsFilter(event.target.value)}
                />
              </div>
            </div>
            <div className="min-h-0 max-h-[260px] flex-1 overflow-auto px-2 py-1 sm:max-h-[340px] lg:max-h-none">
              {pendingProjectArrivals.map((job) => (
                <div
                  key={`creating-${job.id}`}
                  className={cn(
                    "border-b border-primary/30 bg-primary/[0.08] transition-colors dark:bg-primary/[0.14]",
                    selectedProjectName === job.project && "ring-1 ring-inset ring-primary/35",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-h-16 w-full min-w-0 items-center gap-2 px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => {
                      setSelectedProjectName(job.project || "");
                      setSelectedDb("");
                      setExternalLogView(null);
                      selectJob(job.id);
                      setActiveTab("logs");
                    }}
                  >
                    <span className="min-w-0 flex-1 py-2">
                      <span className="block truncate text-sm font-semibold">{job.project}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-primary">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                        {job.title.startsWith(MIGRATION_JOB_PREFIX) ? "Copie en cours…" : "Création en cours…"}
                      </span>
                    </span>
                    <Badge className="shrink-0" variant="outline">Préparation</Badge>
                  </button>
                </div>
              ))}
              {filteredProjects.map((project) => {
                const running = project.odoo_status === "running";
                const absent = project.odoo_status === "absent" || project.odoo_status === "docker off";
                const lifecycleJob =
                  projectLifecycleJobs.get(`Démarrer ${project.name}`) ||
                  projectLifecycleJobs.get(`Arrêter ${project.name}`);
                const switchingOn = lifecycleJob?.title.startsWith("Démarrer ") ?? false;
                const displayedRunning = running || switchingOn;

                return (
                  <div
                    key={project.name}
                    className={cn(
                      "border-b border-border/70 transition-[background-color,border-color] duration-150 hover:border-primary/35 hover:bg-hover last:border-b-0",
                      selectedProject?.name === project.name && "bg-selected",
                      absent && "bg-muted/35 text-muted-foreground",
                    )}
                  >
                    <div className="flex min-h-16 items-center gap-2 px-2">
                      <button
                        type="button"
                        className="-mx-1 min-w-0 flex-1 rounded-md px-1 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => {
                          setSelectedProjectName(project.name);
                          setExternalLogView(null);
                          setActiveTab(project.odoo_status === "running" ? "bases" : "logs");
                        }}
                      >
                        <span className={cn("block truncate text-sm font-semibold", absent ? "text-muted-foreground" : "text-foreground")}>
                          {project.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {project.odoo_version ? `Odoo ${project.odoo_version}` : "Version inconnue"}
                        </span>
                      </button>
                      <div className="flex w-[74px] shrink-0 items-center justify-end gap-2">
                        {lifecycleJob ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Changement d’état en cours" />
                        ) : (
                          <span
                            className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center", displayedRunning ? "text-emerald-500" : "text-red-500")}
                            role="img"
                            aria-label={`${project.name} : ${displayedRunning ? "allumé" : "éteint"}`}
                          >
                            <Circle className="h-5 w-5 fill-current" aria-hidden="true" />
                          </span>
                        )}
                        <span className={cn("w-7 text-xs font-semibold", displayedRunning ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                          {displayedRunning ? "ON" : "OFF"}
                        </span>
                      </div>
                    </div>
                    {settings?.show_technical_details && (
                      <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 text-xs">
                        <Badge variant={statusVariant(project.odoo_status)}>Odoo {project.odoo_status}</Badge>
                        <Badge variant={statusVariant(project.postgres_status)}>PostgreSQL {project.postgres_status}</Badge>
                        <Badge variant="outline">
                          {project.databases?.filter((db) => db !== "postgres").length || 0} base(s)
                        </Badge>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 border-t p-3 lg:grid-cols-1">
              <Button className="col-span-2 w-full lg:col-span-1" onClick={openCreateProjectDialog}>
                <FolderPlus className="h-4 w-4" />
                Nouveau projet
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={openSettingsDialog}
              >
                <Settings className="h-4 w-4" />
                Paramètres
              </Button>
              <Button
                className="w-full"
                variant="secondary"
                onClick={() => setAboutOpen(true)}
              >
                <Info className="h-4 w-4" />
                À propos
              </Button>
            </div>
          </div>
        </aside>

        {/* overflow-x-clip borne le bandeau pleine largeur des onglets sans casser les éléments collés. */}
        <section className="min-w-0 flex-1 overflow-x-clip">
          {/* Sans projet ouvert, l'en-tête et les onglets laissent la place à l'accueil. */}
          {!showWelcome && (
            <header
              ref={projectHeaderRef}
              className={cn(
                "sdk-project-header border-b bg-card",
                stickyHeader && "lg:sticky lg:top-0 lg:z-30 lg:shadow-sm",
              )}
            >
              <div
                className={cn(
                  "mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 transition-[padding] duration-200 motion-reduce:transition-none xl:flex-row xl:items-start xl:justify-between",
                  projectHeaderCompact && "lg:gap-3 lg:py-2 xl:items-center",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-start gap-2">
                    <h2
                      className={cn(
                        "min-w-0 max-w-full break-words text-2xl font-semibold leading-tight sm:text-3xl",
                        projectHeaderCompact && "lg:text-xl",
                      )}
                    >
                      {pendingSelectedProjectArrival?.project || selectedProject?.name || "Aucun projet"}
                    </h2>
                    {pendingSelectedProjectArrival ? (
                      <Badge className="mt-0.5 shrink-0" variant="outline">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {pendingSelectedArrivalIsMigration ? "Copie en cours" : "Création en cours"}
                      </Badge>
                    ) : selectedProject?.odoo_version && (
                      <Badge className="mt-0.5 shrink-0" variant="outline">
                        Odoo {selectedProject.odoo_version}
                      </Badge>
                    )}
                  </div>
                  <p className={cn("mt-1 max-w-full break-all text-sm text-muted-foreground", projectHeaderCompact && "lg:hidden")}>
                    {pendingSelectedProjectArrival
                      ? pendingSelectedArrivalIsMigration
                        ? "Copie du projet vers son nouvel emplacement. Le journal détaille les étapes en cours."
                        : "Préparation du projet local en arrière-plan. Le journal détaille les étapes en cours."
                      : selectedProject?.url || "Sélectionne un projet."}
                  </p>
                </div>
                <div className="grid w-full shrink-0 grid-cols-2 items-stretch gap-2 sm:grid-cols-3 xl:w-[480px]">
                  <Button className="w-full" variant="outline" onClick={refreshAllViews}>
                    <RefreshCcw className="h-4 w-4" />
                    Actualiser
                  </Button>
                  {selectedProjectOnline ? (
                    <Button
                      key="stop-project"
                      className="w-full"
                      variant="destructive"
                      disabled={!selectedProjectReady || !selectedProjectHasContainers || loading || Boolean(selectedProjectLifecycleJob)}
                      onClick={requestStopProject}
                    >
                      {selectedProjectStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                      {selectedProjectStopping ? "Arrêt…" : "Arrêter"}
                    </Button>
                  ) : (
                    <Button
                      key="start-project"
                      className="w-full"
                      disabled={!selectedProjectReady || loading || Boolean(selectedProjectLifecycleJob)}
                      onClick={requestStartProject}
                    >
                      {selectedProjectStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {selectedProjectStarting ? "Démarrage…" : "Démarrer"}
                    </Button>
                  )}
                  {selectedProject && (
                    <Button
                      className="col-span-2 w-full sm:col-span-1"
                      variant="outline"
                      disabled={
                        !selectedProjectReady ||
                        openingOdoo
                      }
                      onClick={requestOpenOdoo}
                    >
                      {openingOdoo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                      {openingOdoo ? "Ouverture…" : "Ouvrir Odoo"}
                    </Button>
                  )}
                </div>
              </div>
            </header>
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
                  <TabsContent value="bases">
                    {refinedInterface ? (
                      <div className="space-y-5">
                        <RefinedSectionHeader
                          title="Bases de données"
                          count={odooDatabases.length}
                          description="Sélectionne la base sur laquelle travailler."
                          actions={
                            <>
                              {selectedProject && (
                                <Button
                                  variant="ghost"
                                  onClick={() => openUrl(selectedProject.database_manager_url)}
                                  title="Ouvrir le gestionnaire de bases d’Odoo"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  Gestionnaire Odoo
                                </Button>
                              )}
                              <Button variant="outline" disabled={!selectedProjectReady} onClick={() => setRestoreDbOpen(true)}>
                                <Upload className="h-4 w-4" />
                                Restaurer
                              </Button>
                              <Button disabled={!selectedProjectReady} onClick={() => setCreateDbOpen(true)}>
                                <PlusCircle className="h-4 w-4" />
                                Créer une base
                              </Button>
                            </>
                          }
                        />

                        {odooDatabases.length ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {odooDatabases.map((db) => (
                              <div key={db} className="group relative min-w-0">
                                <InteractiveCard
                                  aria-pressed={selectedDb === db}
                                  className={cn(
                                    "w-full min-w-0 p-4 pr-14",
                                    selectedDb === db
                                      ? "border-primary bg-selected ring-2 ring-primary/35"
                                      : "hover:border-primary/35 hover:bg-hover",
                                  )}
                                  onClick={() => chooseDatabase(db)}
                                >
                                  <div className="flex min-w-0 items-start gap-2">
                                    <span className={cn("min-w-0 break-all", REFINED_IDENTIFIER)}>{db}</span>
                                    {db === selectedDb && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                                  </div>
                                  <div
                                    className={cn(
                                      "mt-2 text-xs",
                                      db === selectedDb ? "font-medium text-primary" : "text-muted-foreground",
                                    )}
                                  >
                                    {db === selectedDb
                                      ? "Base de travail"
                                      : selectedProject?.database_versions?.[db] || "Base Odoo"}
                                  </div>
                                </InteractiveCard>
                                <DropdownMenu.Root modal={false}>
                                  <DropdownMenu.Trigger>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className={cn(
                                        "absolute right-2 top-2 h-9 w-9 transition-opacity focus-visible:opacity-100 data-[state=open]:opacity-100",
                                        db !== selectedDb && "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
                                      )}
                                      disabled={loading}
                                      title={`Actions sur ${db}`}
                                      aria-label={`Actions sur ${db}`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenu.Trigger>
                                  <DropdownMenu.Content align="end" className="min-w-60">
                                    <DropdownMenu.Label>Maintenance</DropdownMenu.Label>
                                    <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "regenerate_assets")}>
                                      <Paintbrush className="h-4 w-4" />
                                      Régénérer les assets
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "reset_translations")}>
                                      <Languages className="h-4 w-4" />
                                      Réinitialiser les traductions
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "neutralize")}>
                                      <ShieldCheck className="h-4 w-4" />
                                      Neutraliser et contrôler
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "admin_password")}>
                                      <KeyRound className="h-4 w-4" />
                                      Mot de passe admin
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Separator />
                                    <DropdownMenu.Label>Outils</DropdownMenu.Label>
                                    <DropdownMenu.Item
                                      disabled={selectedProject?.postgres_status !== "running" || openingPostgresql}
                                      onSelect={() => runDatabaseAction(db, "psql")}
                                    >
                                      <Terminal className="h-4 w-4" />
                                      Ouvrir psql
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Separator />
                                    <DropdownMenu.Label>Zone dangereuse</DropdownMenu.Label>
                                    <DropdownMenu.Item color="red" onSelect={() => runDatabaseAction(db, "drop")}>
                                      <Trash2 className="h-4 w-4" />
                                      Supprimer la base
                                    </DropdownMenu.Item>
                                  </DropdownMenu.Content>
                                </DropdownMenu.Root>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <FirstDatabaseCallout
                            disabled={!selectedProjectReady}
                            onCreate={() => setCreateDbOpen(true)}
                            onRestore={() => setRestoreDbOpen(true)}
                          />
                        )}

                        <RefinedPanel>
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center justify-between gap-3 rounded-md p-4 text-left transition-colors hover:bg-hover",
                              REFINED_FOCUS_RING,
                            )}
                            aria-expanded={postgresDetailsOpen}
                            aria-controls="refined-postgres-details"
                            onClick={() => setPostgresDetailsOpen((open) => !open)}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", postgresDetailsOpen && "rotate-90")} />
                              <span className={cn("min-w-0", REFINED_ROW_TITLE)}>Infrastructure · PostgreSQL</span>
                            </span>
                            <Badge variant={statusVariant(selectedProject?.postgres_status || "absent")} className="shrink-0">
                              {selectedProject?.postgres_status || "absent"}
                            </Badge>
                          </button>
                          {postgresDetailsOpen && (
                            <div id="refined-postgres-details" className="grid gap-3 border-t p-4 sm:grid-cols-2">
                              <div className="min-w-0 rounded-md bg-muted/55 p-3">
                                <div className="text-xs text-muted-foreground">Conteneur</div>
                                <div className={cn("mt-1 break-all", REFINED_IDENTIFIER)}>
                                  {selectedProject ? `postgresql-${selectedProject.name}` : "-"}
                                </div>
                              </div>
                              <div className="min-w-0 rounded-md bg-muted/55 p-3">
                                <div className="text-xs text-muted-foreground">Base Odoo ciblée</div>
                                <div
                                  className={cn(
                                    "mt-1 break-all",
                                    selectedDb ? REFINED_IDENTIFIER : "text-sm text-muted-foreground",
                                  )}
                                >
                                  {selectedDb || "Aucune base sélectionnée"}
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground sm:col-span-2">
                                La console psql s’ouvre depuis le menu « ⋯ » d’une base, dans le terminal du système.
                              </p>
                            </div>
                          )}
                        </RefinedPanel>
                      </div>
                    ) : (
                      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
                        <Card>
                          <CardHeader>
                            <CardTitle>Bases Odoo</CardTitle>
                            <CardDescription>Sélectionne l’environnement Odoo utilisé pour les modules et les actions.</CardDescription>
                          </CardHeader>
                          <CardContent>
                            {odooDatabases.length ? (
                              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                                {odooDatabases.map((db) => (
                                  <InteractiveCard
                                    key={db}
                                    className={cn(
                                      "min-w-0 p-4",
                                      selectedDb === db && "border-primary bg-selected ring-1 ring-primary/25",
                                    )}
                                    onClick={() => chooseDatabase(db)}
                                  >
                                    <div className="flex min-w-0 items-start justify-between gap-2">
                                      <span className="min-w-0 break-words font-medium">{db}</span>
                                      {db === selectedDb && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                                    </div>
                                    <div className="mt-2 text-sm text-muted-foreground">
                                      {selectedProject?.database_versions?.[db] || "Base Odoo"}
                                    </div>
                                  </InteractiveCard>
                                ))}
                              </div>
                            ) : (
                              <FirstDatabaseCallout
                                disabled={!selectedProjectReady}
                                onCreate={() => setCreateDbOpen(true)}
                                onRestore={() => setRestoreDbOpen(true)}
                              />
                            )}
                          </CardContent>
                        </Card>
                        <div className="grid min-w-0 content-start gap-4">
                          <Card>
                            <CardHeader>
                              <CardTitle>Créer une base Odoo</CardTitle>
                              <CardDescription>Ajoute une nouvelle base métier au projet sélectionné.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <Button className="w-full" disabled={!selectedProjectReady} onClick={() => setCreateDbOpen(true)}>
                                <PlusCircle className="h-4 w-4" />
                                Créer une base Odoo
                              </Button>
                              <Button
                                className="w-full"
                                variant="outline"
                                disabled={!selectedProjectReady}
                                onClick={() => setRestoreDbOpen(true)}
                              >
                                <Upload className="h-4 w-4" />
                                Restaurer une sauvegarde ZIP
                              </Button>
                              {selectedProject && (
                                <Button className="w-full" variant="ghost" onClick={() => openUrl(selectedProject.database_manager_url)}>
                                  <ExternalLink className="h-4 w-4" />
                                  Gestionnaire de bases Odoo
                                </Button>
                              )}
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader>
                              <CardTitle>Neutraliser la base</CardTitle>
                              <CardDescription>
                                Coupe les crons métier et les serveurs de messagerie, puis vérifie le résultat.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="min-w-0 rounded-md bg-muted/55 p-3 text-sm">
                                <div className="text-muted-foreground">Base ciblée</div>
                                <div className="mt-1 break-words font-medium">{selectedDb || "Aucune base sélectionnée"}</div>
                              </div>
                              <Button
                                className="w-full"
                                variant="outline"
                                disabled={!canUseDb || loading}
                                onClick={() => setNeutralizeDbOpen(true)}
                              >
                                <ShieldCheck className="h-4 w-4" />
                                Neutraliser et contrôler
                              </Button>
                              <Button
                                className="w-full"
                                variant="outline"
                                disabled={!canUseDb || loading}
                                onClick={regenerateOdooAssets}
                                title="Supprime les bundles CSS/JS compilés ; Odoo redémarre et les reconstruit au prochain chargement."
                              >
                                <Paintbrush className="h-4 w-4" />
                                Régénérer les assets
                              </Button>
                              <Button className="w-full" variant="outline" disabled={!canUseDb || loading} onClick={openAllTranslationsReset}>
                                <Languages className="h-4 w-4" />
                                Réinitialiser les traductions
                              </Button>
                              <Button className="w-full" variant="outline" disabled={!canUseDb || loading} onClick={() => setAdminPasswordOpen(true)}>
                                <KeyRound className="h-4 w-4" />
                                Réinitialiser le mot de passe admin
                              </Button>
                              <Button
                                className="w-full text-destructive hover:text-destructive"
                                variant="outline"
                                disabled={!canUseDb || loading}
                                onClick={() => setDropDbOpen(true)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Supprimer la base
                              </Button>
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <CardTitle>Serveur PostgreSQL</CardTitle>
                                  <CardDescription className="mt-1">
                                    Service technique qui stocke les bases Odoo. Il ne se sélectionne pas comme une base métier.
                                  </CardDescription>
                                </div>
                                <Badge variant={statusVariant(selectedProject?.postgres_status || "absent")} className="shrink-0">
                                  {selectedProject?.postgres_status || "absent"}
                                </Badge>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div className="min-w-0 rounded-md bg-muted/55 p-3 text-sm">
                                <div className="text-muted-foreground">Conteneur</div>
                                <div className="mt-1 break-all font-medium">{selectedProject ? `postgresql-${selectedProject.name}` : "-"}</div>
                                <div className="mt-3 text-muted-foreground">Base Odoo ciblée</div>
                                <div className="mt-1 break-words font-medium">{selectedDb || "Aucune base sélectionnée"}</div>
                              </div>
                              <Button
                                className="w-full"
                                variant="outline"
                                disabled={!canUseDb || selectedProject?.postgres_status !== "running" || openingPostgresql}
                                onClick={openPostgresqlConsole}
                              >
                                {openingPostgresql ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
                                Ouvrir psql
                              </Button>
                              <p className="text-xs text-muted-foreground">La console s’ouvre dans le terminal du système avec la base Odoo sélectionnée.</p>
                            </CardContent>
                          </Card>
                        </div>
                      </div>
                    )}
                  </TabsContent>
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

                <TabsContent value="logs">
                  {refinedInterface ? (
                    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
                      <div className="min-w-0 space-y-3">
                        <RefinedSectionHeader
                          title="Activité du projet"
                          count={projectJobs.length}
                          actions={
                            projectJobs.length ? (
                              <Button variant="outline" size="sm" onClick={clearJobs}>
                                <Trash2 className="h-4 w-4" />
                                Effacer
                              </Button>
                            ) : undefined
                          }
                        />
                        {projectJobs.length ? (
                          <div className="max-h-[min(62vh,680px)] min-w-0 space-y-2 overflow-y-auto pr-1">
                            {projectJobs.map((job) => {
                              const jobSelected = !scopedExternalLogView && selectedJob?.id === job.id;
                              return (
                                <div
                                  key={job.id}
                                  className={cn(
                                    "min-w-0 rounded-md border bg-card transition-colors",
                                    jobSelected
                                      ? "border-primary bg-selected ring-2 ring-primary/35"
                                      : "hover:border-primary/35 hover:bg-hover",
                                  )}
                                >
                                  <div className="flex min-w-0 items-start gap-1">
                                    <button
                                      type="button"
                                      className={cn("min-w-0 flex-1 rounded-md p-3 text-left", REFINED_FOCUS_RING)}
                                      aria-pressed={jobSelected}
                                      title={job.title}
                                      onClick={() => selectJob(job.id)}
                                    >
                                      <Badge variant={statusVariant(job.status)}>{statusLabel(job.status)}</Badge>
                                      <span className="mt-2 line-clamp-2 break-words text-sm font-medium leading-5">{job.title}</span>
                                      <span className="mt-1 block text-xs tabular-nums text-muted-foreground">{job.started_at}</span>
                                      {job.status === "queued" && job.waiting_for && (
                                        <span className="mt-1 block break-words text-xs text-muted-foreground">{job.waiting_for}</span>
                                      )}
                                    </button>
                                    {!isJobUnfinished(job) && (
                                      <Button
                                        className="m-1 h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        variant="ghost"
                                        size="icon"
                                        title={`Supprimer l'historique ${job.title}`}
                                        aria-label={`Supprimer l'historique ${job.title}`}
                                        onClick={() => deleteJob(job.id)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                  {isJobUnfinished(job) && (
                                    <div className="px-3 pb-3">
                                      <JobStopButton job={job} className="w-full" onRequest={setJobToCancelId} />
                                      {job.status !== "cancelling" && jobStopUnavailableReason(job) && (
                                        <p className="mt-1.5 break-words text-xs text-muted-foreground">{jobStopUnavailableReason(job)}</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <RefinedPanel className="border-dashed p-6 text-center">
                            <Logs className="mx-auto h-6 w-6 text-muted-foreground" />
                            <p className="mt-3 font-medium">Aucune action enregistrée</p>
                            <p className="mt-1 text-sm text-muted-foreground">Les prochaines opérations apparaîtront ici avec leur statut.</p>
                          </RefinedPanel>
                        )}
                      </div>

                      <RefinedPanel>
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
                          <div className="min-w-[min(100%,18rem)] flex-1">
                            <h3 className="break-words text-sm font-semibold">{displayedOutputTitle}</h3>
                            {outputTitleIsLong && (
                              <button
                                type="button"
                                className={cn("mt-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline", REFINED_FOCUS_RING)}
                                aria-expanded={logDescriptionExpanded}
                                onClick={() => setLogDescriptionExpanded((expanded) => !expanded)}
                              >
                                {logDescriptionExpanded ? "Voir moins" : "Voir plus"}
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={showDiagnostics} disabled={!selectedProjectReady}>
                              <Activity className="h-4 w-4" />
                              Diagnostic
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => showLogs()} disabled={!selectedProjectReady}>
                              <Logs className="h-4 w-4" />
                              Logs Odoo
                            </Button>
                            <Button variant="outline" size="sm" onClick={copyOutput}>
                              <Copy className="h-4 w-4" />
                              Copier
                            </Button>
                          </div>
                        </div>
                        <div className="min-w-0 p-4">
                          {!scopedExternalLogView && selectedJob && <JobCancelState job={selectedJob} action={selectedJobStop} />}
                          {!scopedExternalLogView && selectedJob && isJobActive(selectedJob) && (
                            <JobProgressPanel
                              label={outputProgress?.label || selectedJob.last_line || selectedJob.lines.at(-1) || "Traitement en cours"}
                              percent={outputProgressPercent}
                              action={selectedJobStop}
                            />
                          )}
                          {finishedJobSummary && (
                            <div
                              className={cn(
                                "mb-3 rounded-md border p-4",
                                finishedJobSummary.status === "error"
                                  ? "border-destructive/30 bg-destructive/[0.08]"
                                  : finishedJobSummary.status === "cancelled"
                                    ? "border-amber-500/30 bg-amber-500/[0.08]"
                                    : "border-emerald-500/25 bg-emerald-500/[0.08]",
                              )}
                            >
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                {finishedJobSummary.status === "error" ? (
                                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                                ) : finishedJobSummary.status === "cancelled" ? (
                                  <Square className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                )}
                                {finishedJobSummary.status === "error"
                                  ? "Opération en erreur"
                                  : finishedJobSummary.status === "cancelled"
                                    ? "Opération arrêtée"
                                    : "Opération réussie"}
                              </div>
                              <p className="mt-1 break-words text-sm text-muted-foreground">
                                {finishedJobSummary.error_message || (
                                  <>
                                    Terminée le{" "}
                                    <span className="tabular-nums">{finishedJobSummary.finished_at || finishedJobSummary.started_at}</span>.
                                  </>
                                )}
                              </p>
                              <Button
                                className="mt-3"
                                variant="outline"
                                size="sm"
                                aria-expanded={rawOutputVisible}
                                onClick={() => setRawOutputVisible((visible) => !visible)}
                              >
                                {rawOutputVisible ? "Masquer la sortie brute" : "Afficher la sortie brute"}
                              </Button>
                            </div>
                          )}
                          <OdooLogsModeBar view={scopedExternalLogView} onShowFull={() => showLogs(true)} onShowSummary={() => showLogs()} />
                          <JobOutputPre
                            outputRef={logOutputRef}
                            content={outputContent}
                            hidden={rawOutputHidden}
                            onScroll={handleLogOutputScroll}
                          />
                        </div>
                      </RefinedPanel>
                    </div>
                  ) : (
                    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
                      <Card className="min-w-0">
                        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <CardTitle>Historique</CardTitle>
                            <CardDescription>Actions du projet sélectionné.</CardDescription>
                          </div>
                          <Button className="w-full shrink-0 sm:w-auto" variant="outline" size="sm" onClick={clearJobs}>
                            <Trash2 className="h-4 w-4" />
                            Effacer
                          </Button>
                        </CardHeader>
                        <CardContent className="max-h-[min(62vh,680px)] min-w-0 space-y-3 overflow-y-auto">
                          {projectJobs.length ? projectJobs.map((job) => (
                            <div
                              key={job.id}
                              className={cn(
                                "group grid h-[172px] min-w-0 grid-rows-[minmax(0,1fr)_36px] gap-2 rounded-md border bg-card p-3 shadow-sm transition-[background-color,border-color,box-shadow] hover:border-primary/40 hover:shadow-md",
                                !scopedExternalLogView && selectedJob?.id === job.id && "border-primary bg-selected ring-1 ring-primary/25",
                              )}
                            >
                              <button
                                type="button"
                                className="grid min-h-0 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md p-2 text-left transition-colors hover:bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-primary/[0.12]"
                                aria-pressed={!scopedExternalLogView && selectedJob?.id === job.id}
                                title={job.title}
                                onClick={() => selectJob(job.id)}
                              >
                                <span className="flex h-full min-w-0 flex-col justify-between gap-2">
                                  <span className="line-clamp-3 break-words text-sm font-semibold leading-5">{job.title}</span>
                                  <span className="block text-xs tabular-nums text-muted-foreground">
                                    {job.status === "queued" && job.waiting_for ? job.waiting_for : job.started_at}
                                  </span>
                                </span>
                                <Badge className="min-w-[74px] shrink-0 justify-self-end" variant={statusVariant(job.status)}>
                                  {statusLabel(job.status)}
                                </Badge>
                              </button>
                              {isJobUnfinished(job) ? (
                                <JobStopButton job={job} className="w-full" onRequest={setJobToCancelId} />
                              ) : (
                                <Button
                                  className="w-full border-red-300 text-red-700 hover:border-red-400 hover:bg-red-50 hover:text-red-800 active:bg-red-100 focus-visible:ring-red-500 dark:border-red-800 dark:text-red-300 dark:hover:border-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-200 dark:active:bg-red-950"
                                  variant="outline"
                                  size="sm"
                                  title={`Supprimer l'historique ${job.title}`}
                                  aria-label={`Supprimer l'historique ${job.title}`}
                                  onClick={() => deleteJob(job.id)}
                                >
                                  Supprimer
                                </Button>
                              )}
                            </div>
                          )) : (
                            <div className="rounded-md border border-dashed p-6 text-center">
                              <Logs className="mx-auto h-6 w-6 text-muted-foreground" />
                              <p className="mt-3 font-medium">Aucune action enregistrée</p>
                              <p className="mt-1 text-sm text-muted-foreground">Les prochaines opérations apparaîtront ici avec leur statut.</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                      <Card className="min-w-0">
                        <CardHeader className="min-w-0 gap-3 min-[1900px]:flex-row min-[1900px]:items-start min-[1900px]:justify-between">
                          <div className="min-w-0 flex-1">
                            <CardTitle>Sortie</CardTitle>
                            <CardDescription className="break-words">{displayedOutputTitle}</CardDescription>
                            {outputTitleIsLong && (
                              <button
                                type="button"
                                className="mt-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-expanded={logDescriptionExpanded}
                                onClick={() => setLogDescriptionExpanded((expanded) => !expanded)}
                              >
                                {logDescriptionExpanded ? "Voir moins" : "Voir plus"}
                              </button>
                            )}
                          </div>
                          <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 min-[1900px]:w-auto min-[1900px]:shrink-0">
                            <Button className="w-full justify-start sm:justify-center" variant="outline" size="sm" onClick={showDiagnostics} disabled={!selectedProjectReady}>
                              <Activity className="h-4 w-4" />
                              Diagnostic
                            </Button>
                            <Button className="w-full justify-start sm:justify-center" variant="outline" size="sm" onClick={() => showLogs()} disabled={!selectedProjectReady}>
                              <Logs className="h-4 w-4" />
                              Logs Odoo
                            </Button>
                            <Button
                              className="w-full justify-start sm:justify-center"
                              variant="outline"
                              size="sm"
                              onClick={copyOutput}
                            >
                              <Copy className="h-4 w-4" />
                              Copier
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="min-w-0">
                          {!scopedExternalLogView && selectedJob && <JobCancelState job={selectedJob} action={selectedJobStop} />}
                          {!scopedExternalLogView && selectedJob && isJobActive(selectedJob) && (
                            <JobProgressPanel
                              label={outputProgress?.label || selectedJob.last_line || selectedJob.lines.at(-1) || "Traitement en cours"}
                              percent={outputProgressPercent}
                              action={selectedJobStop}
                            />
                          )}
                          <OdooLogsModeBar view={scopedExternalLogView} onShowFull={() => showLogs(true)} onShowSummary={() => showLogs()} />
                          <JobOutputPre outputRef={logOutputRef} content={outputContent} onScroll={handleLogOutputScroll} />
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="actions">
                  {refinedInterface ? (
                    <div className="space-y-5">
                      <RefinedSectionHeader
                        title="Réglages du projet"
                        description={selectedProject ? `Paramètres et actions de ${selectedProject.name}.` : undefined}
                      />
                      <RefinedPanel>
                        <RefinedRow
                          title="Environnement"
                          description={selectedProject?.odoo_version ? `Odoo ${selectedProject.odoo_version} · Docker` : "Docker"}
                        >
                          {selectedProject && (
                            <Button variant="outline" onClick={() => openUrl(selectedProject.url)}>
                              <ExternalLink className="h-4 w-4" />
                              Ouvrir Odoo
                            </Button>
                          )}
                        </RefinedRow>
                        {settings?.show_technical_details && (
                          <RefinedRow
                            className="border-t"
                            title="Code et images"
                            description="Met à jour les sources et images Docker."
                          >
                            <Button variant="outline" disabled={!selectedProjectReady} onClick={() => createJob("update_project", { project: selectedProject?.name })}>
                              <CloudDownload className="h-4 w-4" />
                              MAJ projet
                            </Button>
                            <Button variant="outline" onClick={() => createJob("update_all")}>
                              <CloudDownload className="h-4 w-4" />
                              MAJ tous les projets
                            </Button>
                          </RefinedRow>
                        )}
                        <RefinedRow
                          className="border-t"
                          title="Suppression du projet"
                          description={
                            <>
                              Action définitive. Le projet est déplacé dans <code className="text-xs">.odoo_manager_deleted</code> et le
                              nom devra être saisi pour confirmer.
                            </>
                          }
                        >
                          <Button variant="destructive" disabled={!selectedProjectReady} onClick={() => setDeleteDialogOpen(true)}>
                            <Trash2 className="h-4 w-4" />
                            Supprimer le projet…
                          </Button>
                        </RefinedRow>
                      </RefinedPanel>
                    </div>
                  ) : (
                    <div className={cn("grid gap-4", settings?.show_technical_details && "xl:grid-cols-2")}>
                      {settings?.show_technical_details && (
                        <Card>
                          <CardHeader>
                            <CardTitle>Code et images</CardTitle>
                            <CardDescription>Met à jour les sources et images Docker.</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            <Button className="w-full" variant="outline" disabled={!selectedProjectReady} onClick={() => createJob("update_project", { project: selectedProject?.name })}>
                              <CloudDownload className="h-4 w-4" />
                              MAJ projet
                            </Button>
                            <Button className="w-full" onClick={() => createJob("update_all")}>
                              <CloudDownload className="h-4 w-4" />
                              MAJ tous les projets
                            </Button>
                          </CardContent>
                        </Card>
                      )}
                      <Card>
                        <CardHeader>
                          <CardTitle>Zone sensible</CardTitle>
                          <CardDescription>Suppression du projet local sélectionné.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <Button className="w-full" variant="destructive" disabled={!selectedProjectReady} onClick={() => setDeleteDialogOpen(true)}>
                            <Trash2 className="h-4 w-4" />
                            Supprimer projet
                          </Button>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </TabsContent>
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

      <Dialog open={onboardingOpen} onOpenChange={setOnboardingOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Préparer le gestionnaire Odoo</DialogTitle>
            <DialogDescription>
              Vérifie les prérequis une seule fois, puis crée ton premier environnement depuis l’application.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y overflow-hidden rounded-md border">
            <PrerequisiteRow
              ready={Boolean(creationPrerequisites?.workspace_ready)}
              icon={FolderPlus}
              title="Dossier des projets"
              detail={creationPrerequisites?.workspace || overview?.workspace || "Vérification en cours…"}
            />
            <PrerequisiteRow
              ready={Boolean(systemStatus?.docker.running)}
              icon={Boxes}
              title="Docker"
              detail={systemStatus?.docker.message || "Vérification en cours…"}
              action={
                systemStatus?.docker.running ? undefined : (
                  <Button size="sm" variant="outline" onClick={requestDockerStart} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Ouvrir
                  </Button>
                )
              }
            />
            <PrerequisiteRow
              ready={Boolean(creationPrerequisites?.git_available)}
              icon={GitBranch}
              title="Git"
              detail={[
                creationPrerequisites?.git_version || creationPrerequisites?.git_install_message || "Git doit être disponible sur la machine.",
                creationPrerequisites?.tool_environment,
              ].filter(Boolean).join(" · ")}
              action={
                !creationPrerequisites?.git_available && creationPrerequisites?.git_install_supported ? (
                  <Button size="sm" variant="outline" onClick={requestGitInstall} disabled={loading || gitInstallRunning}>
                    {gitInstallRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                    {gitInstallRunning ? "Installation…" : "Installer"}
                  </Button>
                ) : undefined
              }
            />
            <PrerequisiteRow
              ready={Boolean(creationPrerequisites?.ssh_key_present)}
              icon={KeyRound}
              title="Clé SSH GitLab"
              detail={
                creationPrerequisites?.ssh_key_present
                  ? `${creationPrerequisites.ssh_keys.join(", ")}${creationPrerequisites.tool_environment ? ` · ${creationPrerequisites.tool_environment}` : ""}`
                  : `Ajoute ta clé publique dans ton profil GitLab avant la première création.${creationPrerequisites?.tool_environment ? ` · ${creationPrerequisites.tool_environment}` : ""}`
              }
              action={
                creationPrerequisites?.ssh_keygen_available || creationPrerequisites?.ssh_key_present ? (
                  <div className="flex flex-wrap gap-2">
                    {!creationPrerequisites.ssh_key_present && desktopBridge()?.wslImportSshKey && (
                      <Button
                        size="sm"
                        variant="outline"
                        title="Copie la clé GitLab déjà déclarée de %USERPROFILE%\.ssh dans l’environnement Linux. Elle ne quitte pas ce poste."
                        onClick={requestSshKeyImport}
                      >
                        <KeyRound className="h-4 w-4" />
                        Utiliser ma clé Windows
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openSshAssistant()}>
                      <KeyRound className="h-4 w-4" />
                      {creationPrerequisites.ssh_key_present ? "Voir la clé" : "Générer"}
                    </Button>
                  </div>
                ) : undefined
              }
            />
            <PrerequisiteRow
              ready={Boolean(systemStatus?.traefik?.running)}
              icon={Activity}
              title="Traefik"
              detail={systemStatus?.traefik?.message || "Vérification en cours…"}
              action={
                systemStatus?.traefik && !systemStatus.traefik.running && !systemStatus.traefik.requires_docker ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={requestTraefikInstall}
                    disabled={!creationPrerequisites?.git_available || loading || traefikInstallRunning}
                    title={!creationPrerequisites?.git_available ? "Installe Git avant Traefik" : undefined}
                  >
                    {traefikInstallRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : systemStatus.traefik.installed ? <Play className="h-4 w-4" /> : <CloudDownload className="h-4 w-4" />}
                    {traefikInstallRunning ? "Installation…" : systemStatus.traefik.installed ? "Démarrer" : "Installer"}
                  </Button>
                ) : undefined
              }
            />
          </div>
          {loadingCreationPrerequisites && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Vérification de Git et de la clé SSH…
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={async () => {
                await completeOnboarding();
                setOnboardingOpen(false);
              }}
            >
              Configurer plus tard
            </Button>
            <Button
              disabled={
                loadingCreationPrerequisites ||
                !creationPrerequisites?.workspace_ready ||
                !creationPrerequisites.git_available ||
                !creationPrerequisites.ssh_key_present
              }
              onClick={async () => {
                await completeOnboarding();
                setOnboardingOpen(false);
                openCreateProjectDialog();
              }}
            >
              <FolderPlus className="h-4 w-4" />
              Créer mon premier projet
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sshDialogOpen} onOpenChange={setSshDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Clé SSH GitLab</DialogTitle>
            <DialogDescription>
              Le gestionnaire génère la clé sur cette machine. Seule la clé publique est affichée et peut être copiée.
            </DialogDescription>
          </DialogHeader>
          {sshKeys.length === 0 ? (
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="ssh-key-comment">E-mail professionnel ou commentaire</label>
                <Input
                  id="ssh-key-comment"
                  value={sshComment}
                  onChange={(event) => setSshComment(event.target.value)}
                  placeholder="prenom.nom@sudokeys.com"
                  autoComplete="email"
                />
                <p className="text-xs text-muted-foreground">Ce texte sert uniquement à identifier la clé dans GitLab.</p>
              </div>
              <Button className="w-full" onClick={() => requestSshKeyGeneration()} disabled={generatingSshKey}>
                {generatingSshKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Générer une clé Ed25519
              </Button>
            </div>
          ) : sshRegenerateMode ? (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
                <div className="font-medium">Régénérer la clé id_ed25519</div>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">
                  <li>Une nouvelle paire de clés remplace <code>~/.ssh/id_ed25519</code> sur cette machine.</li>
                  <li>
                    L’ancienne paire n’est pas supprimée : elle est déplacée dans <code>~/.ssh/odoo-manager-backups</code>.
                  </li>
                  <li>
                    Tant que la nouvelle clé publique n’est pas ajoutée dans GitLab, les imports et mises à jour de dépôts échoueront.
                    Les autres services qui utilisaient l’ancienne clé (serveurs, GitHub…) devront aussi être mis à jour.
                  </li>
                </ul>
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="ssh-key-regenerate-comment">E-mail professionnel ou commentaire</label>
                <Input
                  id="ssh-key-regenerate-comment"
                  value={sshComment}
                  onChange={(event) => setSshComment(event.target.value)}
                  placeholder="prenom.nom@sudokeys.com"
                  autoComplete="email"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={sshRegenerateConfirmed}
                  onCheckedChange={(checked) => setSshRegenerateConfirmed(checked === true)}
                />
                J’ai compris que je devrai ajouter la nouvelle clé publique dans GitLab.
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setSshRegenerateMode(false)} disabled={generatingSshKey}>
                  Annuler
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => requestSshKeyGeneration(true)}
                  disabled={!sshRegenerateConfirmed || generatingSshKey}
                >
                  {generatingSshKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                  Régénérer la clé
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {sshKeyBackup && (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100">
                  <div className="font-medium">Nouvelle clé générée</div>
                  <p className="mt-1 text-xs leading-5">
                    Copie-la puis ajoute-la dans GitLab. Pense à retirer l’ancienne clé de GitLab ensuite.
                    Ancienne clé conservée dans : <code className="break-all">{sshKeyBackup}</code>
                  </p>
                </div>
              )}
              {sshKeys.length > 1 && (
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="ssh-public-key-select">Clé publique</label>
                  <Select value={selectedSshKey?.name || ""} onValueChange={setSelectedSshKeyName}>
                    <SelectTrigger id="ssh-public-key-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sshKeys.map((key) => <SelectItem key={key.name} value={key.name}>{key.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="ssh-public-key">Clé publique à ajouter dans GitLab</label>
                <Textarea
                  id="ssh-public-key"
                  className="min-h-32 resize-y break-all font-mono text-xs"
                  readOnly
                  value={selectedSshKey?.public_key || ""}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" onClick={copySshPublicKey} disabled={!selectedSshKey}>
                  <Copy className="h-4 w-4" />
                  Copier la clé
                </Button>
                <Button
                  onClick={() => openUrl(creationPrerequisites?.gitlab_ssh_keys_url)}
                  disabled={!creationPrerequisites?.gitlab_ssh_keys_url}
                >
                  <ExternalLink className="h-4 w-4" />
                  Ouvrir GitLab
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Dans GitLab, colle cette valeur dans le champ Clé SSH, donne-lui un titre correspondant à cet ordinateur, puis valide.
              </p>
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">Clé compromise, perdue ou à renouveler ?</p>
                <Button variant="outline" onClick={() => startSshKeyRegeneration()} disabled={generatingSshKey}>
                  <RefreshCcw className="h-4 w-4" />
                  Régénérer la clé
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="flex h-[min(820px,calc(100dvh-4rem))] max-h-[calc(100dvh-4rem)] max-w-5xl flex-col gap-0 overflow-hidden !p-0">
          <DialogHeader className="border-b px-5 py-4 sm:px-6">
            <DialogTitle>Paramètres du gestionnaire</DialogTitle>
            <DialogDescription>Réglages communs à tous les projets du workspace.</DialogDescription>
          </DialogHeader>
          {settingsDraft ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <nav
                  className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-60 md:flex-col md:overflow-x-visible md:border-b-0 md:border-r md:p-3"
                  aria-label="Sections des paramètres"
                >
                  {SETTINGS_SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const active = settingsSection === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "bg-selected font-medium text-primary" : "text-muted-foreground hover:bg-hover hover:text-foreground",
                        )}
                        onClick={() => setSettingsSection(section.id)}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 whitespace-nowrap">{section.label}</span>
                        {section.id === "diagnostic" && managerErrors.length > 0 && (
                          <Badge variant="warning" className="shrink-0">{managerErrors.length}</Badge>
                        )}
                      </button>
                    );
                  })}
                </nav>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                  {settingsSection === "general" && (
                    <SettingsSection title="Général" description="Emplacement des projets et configuration de base du poste.">
                      <SettingsGroup>
                        <div className="grid min-w-0 gap-1.5 text-sm font-medium">
                          <label htmlFor="projects-workspace">Dossier des projets</label>
                          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                            <Input
                              id="projects-workspace"
                              className="min-w-0 flex-1"
                              value={settingsDraft.workspace}
                              onChange={(event) => setSettingsDraft({ ...settingsDraft, workspace: event.target.value })}
                              placeholder="/chemin/vers/Odoo-projects"
                            />
                            <Button
                              className="shrink-0"
                              type="button"
                              variant="outline"
                              disabled={!desktopRuntime || selectingWorkspace}
                              title={desktopRuntime ? "Choisir un dossier" : "Disponible dans l’application installée"}
                              onClick={selectWorkspaceDirectory}
                            >
                              {selectingWorkspace ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                              Choisir
                            </Button>
                          </div>
                          <span className="text-xs font-normal leading-relaxed text-muted-foreground">
                            Le dossier est créé s’il n’existe pas encore. Dans l’application installée, « Choisir » ouvre le sélecteur du système.
                          </span>
                        </div>

                      </SettingsGroup>
                      <div className="rounded-md border bg-muted/40 p-3">
                        <div className="text-sm font-medium">Exécution automatique</div>
                        <p className="mt-1 text-xs font-normal leading-relaxed text-muted-foreground">
                          Le gestionnaire choisit automatiquement les outils adaptés au système. Sous Windows, Docker,
                          Git et les chemins sont exécutés dans l’environnement compatible avec le workspace. Les chemins Windows
                          sont traduits automatiquement lorsque Docker ou Git passe par WSL.
                        </p>
                      </div>

                      <SettingsGroup>
                        {migration?.available && migrationCandidates.length > 0 && (
                          <div className="grid gap-3">
                            <div>
                              <div className="text-sm font-medium">Projets restés sur le disque Windows</div>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground" title={migration.source}>
                                Les copier ici fait démarrer Odoo en quelques secondes au lieu d’une minute. Le dossier
                                d’origine n’est pas modifié : tant qu’il est là, la proposition reste disponible.
                              </p>
                            </div>
                            <div className="grid gap-2 text-sm">
                              <MigrationProposal
                                candidates={migrationCandidates}
                                loading={loading}
                                onMigrate={(project, force) => {
                                  setSettingsOpen(false);
                                  void requestProjectMigration(project, force);
                                }}
                              />
                            </div>
                            <label className="flex cursor-pointer items-start gap-3 text-sm">
                              <Checkbox
                                className="mt-0.5"
                                checked={!settingsDraft.migration_banner_dismissed}
                                onCheckedChange={(checked) =>
                                  setSettingsDraft({ ...settingsDraft, migration_banner_dismissed: checked !== true })
                                }
                              />
                              <span className="min-w-0">
                                <span className="block font-medium">Proposer la copie sur l’écran d’accueil</span>
                                <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
                                  Décoché, le bandeau ne revient plus. La copie reste possible depuis ici.
                                </span>
                              </span>
                            </label>
                          </div>
                        )}

                        <div className="grid gap-3">
                          <div>
                            <div className="text-sm font-medium">Configuration initiale</div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              Rouvre l’assistant du premier démarrage pour vérifier le workspace, Docker, Git, SSH et Traefik.
                            </p>
                          </div>
                          <Button type="button" variant="outline" onClick={reopenInitialConfiguration}>
                            <Settings className="h-4 w-4" />
                            Ouvrir l’assistant de configuration
                          </Button>
                        </div>

                      </SettingsGroup>
                    </SettingsSection>
                  )}

                  {settingsSection === "appearance" && (
                    <SettingsSection title="Apparence" description="Organisation des écrans et éléments affichés.">
                      <SettingsGroup>
                        <div className="grid gap-3">
                          <div>
                          <div className="text-sm font-medium">Mise en page</div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            L’interface affinée réorganise Bases, Modules, Activité et Réglages du projet : moins de vide, colonnes
                            alignées, survols et focus plus visibles, sortie technique dépliée à la demande. Aucune action ni
                            information n’est retirée.
                          </p>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Interface">
                            {([
                              ["classic", "Classique", "Interface actuelle, inchangée."],
                              ["refined", "Affinée (bêta)", "Nouvelle organisation des écrans Bases, Modules, Activité et Réglages."],
                            ] as const).map(([value, title, description]) => (
                              <InteractiveCard
                                key={value}
                                role="radio"
                                aria-checked={(settingsDraft.interface_layout ?? "classic") === value}
                                className={cn("p-3 text-left", (settingsDraft.interface_layout ?? "classic") === value && "border-primary bg-selected")}
                                onClick={() => setSettingsDraft({ ...settingsDraft, interface_layout: value })}
                              >
                                <span className="block text-sm font-medium">{title}</span>
                                <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                              </InteractiveCard>
                            ))}
                          </div>
                        </div>

                      </SettingsGroup>
                      <SettingsGroup>
                        <div className="grid gap-2">
                          <div>
                            <div className="text-sm font-medium">Icône affichée</div>
                            <p className="mt-1 text-xs font-normal text-muted-foreground">
                              Choisis l’identité visuelle utilisée dans le gestionnaire.
                            </p>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Icône affichée">
                            <InteractiveCard
                              className={cn(
                                "flex min-h-24 items-center gap-3 p-3",
                                settingsDraft.interface_icon === "manager" && "border-primary bg-selected ring-1 ring-primary/25",
                              )}
                              role="radio"
                              aria-checked={settingsDraft.interface_icon === "manager"}
                              onClick={() => setSettingsDraft({ ...settingsDraft, interface_icon: "manager" })}
                            >
                              <img src={appIcon.src} alt="" aria-hidden="true" className="h-14 w-14 shrink-0 rounded-[13px] object-cover" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold">SDK Local Manager</span>
                                <span className="mt-1 block text-xs text-muted-foreground">Logo Sudokeys</span>
                              </span>
                              {settingsDraft.interface_icon === "manager" && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
                            </InteractiveCard>
                            <InteractiveCard
                              className={cn(
                                "flex min-h-24 items-center gap-3 p-3",
                                settingsDraft.interface_icon === "local" && "border-primary bg-selected ring-1 ring-primary/25",
                              )}
                              role="radio"
                              aria-checked={settingsDraft.interface_icon === "local"}
                              onClick={() => setSettingsDraft({ ...settingsDraft, interface_icon: "local" })}
                            >
                              <img src={localIcon.src} alt="" aria-hidden="true" className="h-14 w-14 shrink-0 rounded-full object-cover" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold">Logo Local</span>
                                <span className="mt-1 block text-xs text-muted-foreground">Nouvelle icône</span>
                              </span>
                              {settingsDraft.interface_icon === "local" && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
                            </InteractiveCard>
                          </div>
                        </div>

                      </SettingsGroup>
                      <div className="divide-y overflow-hidden rounded-md border bg-card">
                      <label className="flex cursor-pointer items-start gap-3 p-3 text-sm transition-colors hover:bg-hover">
                        <Checkbox
                          className="mt-0.5"
                          checked={settingsDraft.show_technical_details}
                          onCheckedChange={(checked) =>
                            setSettingsDraft({ ...settingsDraft, show_technical_details: checked === true })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">Afficher les détails techniques</span>
                          <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
                            Affiche les états Odoo et PostgreSQL ainsi que le nombre de bases dans la liste des projets,
                            les emplacements des modules, et les actions de mise à jour du code et des images Docker.
                            Désactivé, le gestionnaire présente uniquement le voyant d’état des projets et une liste de modules compacte.
                          </span>
                        </span>
                      </label>

                      <label className="flex cursor-pointer items-start gap-3 p-3 text-sm transition-colors hover:bg-hover">
                        <Checkbox
                          className="mt-0.5"
                          checked={settingsDraft.sticky_header}
                          onCheckedChange={(checked) =>
                            setSettingsDraft({ ...settingsDraft, sticky_header: checked === true })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">En-tête fixe</span>
                          <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
                            Garde le nom du projet, les actions et les onglets visibles pendant le défilement.
                            L’en-tête se compacte dès que la page défile. Sur les fenêtres étroites, il reste non fixe pour préserver la place.
                          </span>
                        </span>
                      </label>

                      </div>
                    </SettingsSection>
                  )}

                  {settingsSection === "accounts" && (
                    <SettingsSection
                      title="Comptes et accès"
                      description="Clé SSH, GitLab et identifiants mémorisés. Ces réglages s’appliquent immédiatement, sans enregistrement."
                    >
                      <div className="grid gap-3 rounded-md border p-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">Clé SSH GitLab</div>
                            <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                              {selectedSshKey
                                ? `${selectedSshKey.name} · ${selectedSshKey.public_key}`
                                : "Aucune clé publique détectée dans l’environnement Git utilisé par le gestionnaire."}
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button type="button" variant="outline" className={cn(!selectedSshKey && "sm:col-span-2")} onClick={() => openSshAssistant()}>
                            <KeyRound className="h-4 w-4" />
                            {selectedSshKey ? "Gérer la clé SSH" : "Configurer une clé"}
                          </Button>
                          {selectedSshKey && (
                            <Button type="button" variant="outline" onClick={() => openSshAssistant(true)}>
                              <RefreshCcw className="h-4 w-4" />
                              Régénérer la clé
                            </Button>
                          )}
                        </div>
                      </div>

                      {gitlabStatus && (
                        <div className="grid gap-3 rounded-md border p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-medium">Recherche de dépôts GitLab</div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {gitlabStatus.connected
                                  ? `Connecté à gitlab.sudokeys.com${gitlabStatus.username ? ` en tant que @${gitlabStatus.username}` : ""}. « Dépôt SSH » propose la recherche de dépôts et de branches ; le lien SSH reste le mode par défaut.`
                                  : "Désactivée : « Dépôt SSH » utilise le lien SSH. Connecte un jeton personnel en lecture seule (portée read_api) pour chercher un dépôt et choisir sa branche."}
                              </p>
                            </div>
                            {gitlabStatus.connected && (
                              <Button
                                type="button"
                                variant="outline"
                                className="shrink-0"
                                onClick={async () => {
                                  try {
                                    setGitlabStatus(await window.sdkDesktop!.gitlabDisconnect());
                                    pushToast("success", "GitLab déconnecté.");
                                  } catch {
                                    pushToast("error", "Impossible de déconnecter GitLab.");
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                                Déconnecter
                              </Button>
                            )}
                          </div>
                          {!gitlabStatus.available && <p className="text-xs text-amber-700 dark:text-amber-300">{gitlabStatus.reason}</p>}
                          {gitlabStatus.available && !gitlabStatus.connected && (
                            <form
                              className="flex flex-col gap-2 sm:flex-row"
                              onSubmit={async (event) => {
                                event.preventDefault();
                                if (!gitlabTokenDraft.trim()) return;
                                setGitlabConnecting(true);
                                try {
                                  setGitlabStatus(await window.sdkDesktop!.gitlabConnect(gitlabTokenDraft));
                                  setGitlabTokenDraft("");
                                  pushToast("success", "GitLab connecté : la recherche de dépôts est activée.");
                                } catch (err) {
                                  pushToast("error", desktopErrorMessage(err, "Connexion GitLab impossible."));
                                } finally {
                                  setGitlabConnecting(false);
                                }
                              }}
                            >
                              <Input
                                type="password"
                                autoComplete="off"
                                value={gitlabTokenDraft}
                                onChange={(event) => setGitlabTokenDraft(event.target.value)}
                                placeholder="Jeton personnel GitLab (glpat-…)"
                                aria-label="Jeton personnel GitLab"
                              />
                              <Button type="submit" className="shrink-0" disabled={gitlabConnecting || !gitlabTokenDraft.trim()}>
                                {gitlabConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                                Activer
                              </Button>
                              <Button type="button" variant="ghost" className="shrink-0" onClick={() => void openExternalUrl(GITLAB_TOKEN_URL)}>
                                <ExternalLink className="h-4 w-4" />
                                Créer un jeton
                              </Button>
                            </form>
                          )}
                        </div>
                      )}

                      {storedRikaCredentials?.available && (
                        <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">Identifiants RIKA</div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {storedRikaCredentials.login
                                ? `${storedRikaCredentials.login} · ${storedRikaCredentials.password ? "identifiant et mot de passe" : "identifiant seul"} dans le coffre-fort du système.`
                                : "Aucun identifiant mémorisé sur cet ordinateur."}
                            </p>
                          </div>
                          {storedRikaCredentials.login && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={async () => {
                                try {
                                  await window.sdkDesktop?.clearRikaCredentials();
                                  setStoredRikaCredentials({ ...storedRikaCredentials, login: "", password: "" });
                                  pushToast("success", "Identifiants RIKA oubliés.");
                                } catch {
                                  pushToast("error", "Impossible d’effacer les identifiants RIKA.");
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              Oublier
                            </Button>
                          )}
                        </div>
                      )}

                    </SettingsSection>
                  )}

                  {settingsSection === "advanced" && (
                    <SettingsSection title="Avancé" description="Outils système, détection de Docker et réseau local.">
                      <SettingsGroup className="items-start sm:grid-cols-2">
                        <label className="grid gap-1.5 text-sm font-medium">
                          Commande Docker
                          <Input
                            value={settingsDraft.docker_executable}
                            onChange={(event) => setSettingsDraft({ ...settingsDraft, docker_executable: event.target.value })}
                            placeholder="docker"
                          />
                        </label>

                        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
                          Dossier Traefik
                          <Input
                            value={settingsDraft.traefik_directory}
                            onChange={(event) => setSettingsDraft({ ...settingsDraft, traefik_directory: event.target.value })}
                            placeholder="Détection automatique si vide"
                          />
                        </label>

                        <label className="grid gap-1.5 text-sm font-medium">
                          Vérification Docker (secondes)
                          <Input
                            type="number"
                            min={3}
                            max={60}
                            value={settingsDraft.docker_poll_interval}
                            onChange={(event) => setSettingsDraft({ ...settingsDraft, docker_poll_interval: Number(event.target.value) })}
                          />
                        </label>

                        <label className="grid gap-1.5 text-sm font-medium">
                          Port local du gestionnaire
                          <Input
                            type="number"
                            min={1024}
                            max={65535}
                            value={settingsDraft.api_port}
                            onChange={(event) => setSettingsDraft({ ...settingsDraft, api_port: Number(event.target.value) })}
                          />
                          <span className="text-xs font-normal leading-relaxed text-muted-foreground">
                            Port préféré de l’API locale. Un redémarrage est nécessaire après modification. S’il est occupé, notamment par Docker, le gestionnaire choisit automatiquement un port libre.
                          </span>
                        </label>

                      </SettingsGroup>
                      <div className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm">
                        <div>
                          <div className="font-medium">Ports utilisés ou contactés</div>
                          <p className="mt-1 text-xs text-muted-foreground">Les ports internes Docker ne sont pas réservés sur Windows sauf publication explicite du projet.</p>
                        </div>
                        <div className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[100px_minmax(0,1fr)]">
                          <code>{settingsDraft.api_port_actual || settingsDraft.api_port}</code><span>API locale du gestionnaire, sur <code>127.0.0.1</code> uniquement</span>
                          <code>{systemStatus?.traefik?.http_port ?? 80}</code>
                          <span>
                            Traefik, accès HTTP aux projets
                            {systemStatus?.traefik?.external && systemStatus.traefik.container ? ` (instance existante : ${systemStatus.traefik.container})` : ""}
                          </span>
                          <code>8069</code><span>Odoo à l’intérieur de chaque conteneur</span>
                          <code>5432</code><span>PostgreSQL à l’intérieur de chaque conteneur</span>
                          <code>10022</code><span>Connexion SSH sortante vers GitLab Sudokeys</span>
                          <code>3000</code><span>Interface Next.js, uniquement en mode développement</span>
                        </div>
                        {settingsDraft.api_port_actual && settingsDraft.api_port_actual !== settingsDraft.api_port && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            Le port {settingsDraft.api_port} était occupé au démarrage. Cette session utilise automatiquement le port {settingsDraft.api_port_actual}.
                          </p>
                        )}
                      </div>

                      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                        <div>Plateforme : {settingsDraft.platform || systemStatus?.docker.platform || "-"}</div>
                        <div className="mt-1 break-all">Configuration : {settingsDraft.config_file || "-"}</div>
                      </div>

                    </SettingsSection>
                  )}

                  {settingsSection === "diagnostic" && (
                    <SettingsSection title="Diagnostic" description="Erreurs enregistrées localement pour le support.">
                      <div className="grid gap-3 rounded-md border p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">Journal d’erreurs du gestionnaire</div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              Les erreurs d’API, de jobs et d’interface sont conservées localement. Les mots de passe, jetons et secrets détectés sont masqués.
                            </p>
                            {managerErrorLogPath && <p className="mt-1 break-all text-xs text-muted-foreground">Fichier : {managerErrorLogPath}</p>}
                          </div>
                          <Badge className="shrink-0" variant={managerErrors.length ? "warning" : "secondary"}>
                            {managerErrors.length} erreur(s)
                          </Badge>
                        </div>
                        <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-2">
                          {loadingManagerErrors ? (
                            <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
                            </div>
                          ) : managerErrors.length ? managerErrors.map((entry) => (
                            <details key={entry.id} className="rounded-md border bg-card p-2 text-xs">
                              <summary className="cursor-pointer break-words font-medium">
                                {entry.timestamp} · {entry.source}{entry.project ? ` · ${entry.project}` : ""}
                              </summary>
                              <p className="mt-2 whitespace-pre-wrap break-words text-destructive">{entry.message}</p>
                              {entry.details && <pre className="log-terminal mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-2 text-[11px] text-slate-100">{entry.details}</pre>}
                            </details>
                          )) : (
                            <p className="p-2 text-xs text-muted-foreground">Aucune erreur enregistrée.</p>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <Button type="button" variant="outline" onClick={loadManagerErrors} disabled={loadingManagerErrors}>
                            <RefreshCcw className="h-4 w-4" /> Actualiser
                          </Button>
                          <Button type="button" variant="outline" onClick={copyManagerErrors} disabled={!managerErrors.length}>
                            <Copy className="h-4 w-4" /> Copier
                          </Button>
                          <Button type="button" variant="outline" onClick={clearManagerErrors} disabled={!managerErrors.length}>
                            <Trash2 className="h-4 w-4" /> Effacer
                          </Button>
                        </div>
                      </div>

                    </SettingsSection>
                  )}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className={cn("text-xs", settingsDirty ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                  {settingsDirty ? "Modifications non enregistrées." : "Aucune modification en attente."}
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button variant="outline" onClick={() => setSettingsOpen(false)}>Annuler</Button>
                  <Button
                    disabled={savingSettings || !settingsDirty || !settingsDraft.workspace.trim() || settingsDraft.api_port < 1024 || settingsDraft.api_port > 65535}
                    onClick={saveSettings}
                  >
                    {savingSettings && <Loader2 className="h-4 w-4 animate-spin" />}
                    Enregistrer
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="m-5 flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement des paramètres...
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>À propos d’SDK Local Manager</DialogTitle>
            <DialogDescription>
              Gestionnaire local pour créer, administrer et maintenir des environnements Odoo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="overflow-hidden rounded-md border">
              <div className="flex min-w-0 items-center gap-3 bg-muted/35 p-4">
                <img
                  src={selectedAppIcon.src}
                  alt=""
                  aria-hidden="true"
                  className={cn(
                    "h-12 w-12 shrink-0 object-cover",
                    settings?.interface_icon === "local" ? "rounded-full" : "rounded-[11px]",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">SDK Local Manager</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">Application desktop multi-plateforme</div>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  title="Copier les informations de version"
                  aria-label="Copier les informations de version"
                  onClick={async () => {
                    const details = [`Build ${APP_BUILD || "local"}`, APP_COMMIT && `commit ${APP_COMMIT}`].filter(Boolean).join(", ");
                    try {
                      await navigator.clipboard.writeText(`SDK Local Manager ${appVersion} (${details})`);
                      pushToast("success", "Informations de version copiées.");
                    } catch {
                      pushToast("error", "Impossible de copier les informations de version.");
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <dl className={cn("grid divide-x border-t text-sm", APP_COMMIT ? "grid-cols-3" : "grid-cols-2")}>
                <div className="min-w-0 px-4 py-3">
                  <dt className={REFINED_LABEL}>Version</dt>
                  <dd className="mt-1 font-medium tabular-nums">{appVersion}</dd>
                </div>
                <div className="min-w-0 px-4 py-3">
                  <dt className={REFINED_LABEL}>Build</dt>
                  <dd className={cn("mt-1 font-medium tabular-nums", !APP_BUILD && "text-muted-foreground")}>
                    {APP_BUILD || "Local"}
                  </dd>
                </div>
                {APP_COMMIT && (
                  <div className="min-w-0 px-4 py-3">
                    <dt className={REFINED_LABEL}>Commit</dt>
                    <dd className="mt-1 truncate font-mono text-[13px]" title={APP_COMMIT}>{APP_COMMIT}</dd>
                  </div>
                )}
              </dl>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-sm font-semibold">À propos du créateur</div>
              <div className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
                <Heart className="mt-0.5 h-4 w-4 shrink-0 fill-current text-red-500" aria-hidden="true" />
                <p>Fait avec amour par Aymerick Benjamin LAURETTA-PERONNE</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={socleDialogOpen} onOpenChange={setSocleDialogOpen}>
        <DialogContent className="flex max-w-5xl flex-col gap-4 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Installer un socle Odoo</DialogTitle>
            <DialogDescription>
              Sélectionne les applications à installer dans {selectedDb || "la base choisie"}. Les dépendances et les modules
              qu’Odoo installe automatiquement sont calculés à partir des manifestes du projet.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={socleSearch}
              onChange={(event) => setSocleSearch(event.target.value)}
              placeholder="Rechercher une application ou un module technique"
              aria-label="Rechercher une application"
            />
          </div>
          <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
            {!socleCatalog && loadingSocleCatalog && (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lecture des manifestes du projet…
              </div>
            )}
            {socleCatalog && !socleCatalog.states_available && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
                État des modules de la base indisponible : les modules déjà installés ne peuvent pas être détectés.
              </div>
            )}
            {socleCatalog?.sections.map((section) => {
              const apps = visibleSocleApps.filter((app) => app.section === section.id);
              if (!apps.length) return null;
              return (
                <section key={section.id} aria-labelledby={`socle-section-${section.id}`}>
                  <h3 id={`socle-section-${section.id}`} className="mb-2 text-sm font-semibold">{section.label}</h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {apps.map((app) => {
                      const unavailable = app.missing.length > 0;
                      const alreadyInstalled = socleAppInstalled(app);
                      return (
                        <label
                          key={app.id}
                          className={cn(
                            "flex min-w-0 items-start gap-3 rounded-md border p-2.5 text-sm transition-colors",
                            unavailable || alreadyInstalled ? "cursor-not-allowed bg-muted/35 opacity-60" : "cursor-pointer hover:bg-hover",
                            selectedSoclePresets.has(app.id) && !alreadyInstalled && "border-primary bg-selected",
                          )}
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={alreadyInstalled || selectedSoclePresets.has(app.id)}
                            disabled={unavailable || alreadyInstalled || loading}
                            onCheckedChange={(checked) => toggleSoclePreset(app.id, checked === true)}
                          />
                          <img src={`/odoo-apps/${app.id}.svg`} alt="" aria-hidden="true" className="h-9 w-9 shrink-0 object-contain" />
                          <span className="min-w-0">
                            <span className="block font-medium">{app.label}</span>
                            <span className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground">{app.modules.join(" + ")}</span>
                            {unavailable ? (
                              <span className="mt-0.5 block text-xs text-destructive">Absent de cette version : {app.missing.join(", ")}</span>
                            ) : alreadyInstalled ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">Déjà installé</span>
                            ) : app.extra_count > 0 ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">+ {app.extra_count} module(s) installé(s) avec</span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {socleCatalog && !visibleSocleApps.length && (
              <p className="py-6 text-center text-sm text-muted-foreground">Aucune application ne correspond à la recherche.</p>
            )}
          </div>
          <div className="space-y-3 border-t pt-3">
            <div className="max-h-[20dvh] overflow-y-auto rounded-md border bg-muted/35 p-3 text-sm sm:max-h-[30dvh]" aria-live="polite">
              {!soclePresetsToInstall.length ? (
                <p className="text-muted-foreground">Sélectionne des applications pour voir tout ce qui sera installé.</p>
              ) : loadingSoclePlan && !soclePlan ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Calcul des dépendances…
                </p>
              ) : soclePlanError ? (
                <p className="text-destructive">{soclePlanError}</p>
              ) : soclePlan ? (
                <div className={cn("space-y-2", loadingSoclePlan && "opacity-60")}>
                  <div className="font-medium">
                    {soclePlan.total} module(s) seront installés
                    <span className="font-normal text-muted-foreground">
                      {" "}· {soclePlan.requested.length} demandé(s), {soclePlan.dependencies.length} dépendance(s),
                      {" "}{soclePlan.auto_installed.length} automatique(s)
                    </span>
                  </div>
                  {soclePlan.applications.length > 0 && (
                    <div className="text-xs">
                      <span className="font-medium">Applications ajoutées en plus :</span>{" "}
                      {soclePlan.applications.map((item) => item.title).join(", ")}
                    </div>
                  )}
                  {(soclePlan.missing.length > 0 || soclePlan.uninstallable.length > 0) && (
                    <div className="text-xs text-destructive">
                      Installation impossible, dépendances introuvables ou non installables :{" "}
                      {[...soclePlan.missing, ...soclePlan.uninstallable].map((item) => `${item.name} (requis par ${item.required_by})`).join(", ")}
                    </div>
                  )}
                  {soclePlan.dependencies.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-xs font-medium">Dépendances ({soclePlan.dependencies.length})</summary>
                      <PlanModuleChips items={soclePlan.dependencies} />
                    </details>
                  )}
                  {soclePlan.auto_installed.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-xs font-medium">
                        Installés automatiquement par Odoo ({soclePlan.auto_installed.length})
                      </summary>
                      <PlanModuleChips items={soclePlan.auto_installed} />
                    </details>
                  )}
                </div>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" disabled={!selectedProject || loading} onClick={repairEnterpriseLinks}>
                <RefreshCcw className="h-4 w-4" />
                Vérifier / créer les liens uniquement
              </Button>
              <Button
                disabled={!selectedDb || loading || !soclePresetsToInstall.length || loadingSoclePlan || soclePlanBlocked}
                onClick={installSelectedSocle}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}
                Installer la sélection{soclePlan && soclePresetsToInstall.length ? ` (${soclePlan.total} modules)` : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={repositoryOpen} onOpenChange={setRepositoryOpen}>
        <DialogContent className="flex max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 pb-4 pt-6">
            <DialogTitle>Importer des modules depuis Git</DialogTitle>
            <DialogDescription>
              Le code est copié dans {selectedProject?.name}. Un module absent est ajouté, une copie déjà gérée est mise à jour.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <section className="space-y-3" aria-labelledby="repository-source-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="repository-source-title" className="text-sm font-semibold">Dépôt et branche</h3>
                <RepositorySourceToggle value={repositorySource} onChange={setRepositorySource} status={gitlabStatus} />
              </div>
              {repositorySource === "gitlab" && (gitlabStatus?.available || gitlabStatus?.unreadable) ? (
                <GitLabRepositoryPicker
                  status={gitlabStatus}
                  url={repositoryUrl}
                  branch={repositoryBranch}
                  preferredBranches={selectedProject?.odoo_version ? [selectedProject.odoo_version] : []}
                  onChange={({ url, branch }) => {
                    setRepositoryUrl(url);
                    setRepositoryBranch(branch);
                  }}
                  onManageAccount={() => {
                    setRepositoryOpen(false);
                    openAccountSettings();
                  }}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                  <label className="grid gap-1.5 text-sm font-medium">
                    URL SSH du dépôt
                    <Input
                      value={repositoryUrl}
                      onChange={(event) => setRepositoryUrl(event.target.value)}
                      placeholder="ssh://git@gitlab.sudokeys.com:10022/equipe/depot.git"
                      aria-invalid={Boolean(repositoryUrlError)}
                      aria-describedby={repositoryUrlError ? "repository-url-error" : undefined}
                    />
                    {repositoryUrlError && <span id="repository-url-error" className="text-xs font-normal text-destructive">{repositoryUrlError}</span>}
                  </label>
                  <label className="grid content-start gap-1.5 text-sm font-medium">
                    Branche ou tag
                    <Input
                      value={repositoryBranch}
                      onChange={(event) => setRepositoryBranch(event.target.value)}
                      placeholder={selectedProject?.odoo_version || "18.0"}
                      className="font-mono"
                    />
                  </label>
                </div>
              )}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />
                Accès par la clé SSH de cet ordinateur, sans jeton stocké.
                <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => openSshAssistant()}>
                  Gérer la clé SSH
                </button>
              </p>
            </section>

            <section className="space-y-3 border-t pt-5" aria-labelledby="repository-modules-title">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="repository-modules-title" className="text-sm font-semibold">Modules</h3>
                {repositoryInspection.status === "ready" && (
                  <span className="font-mono text-xs text-muted-foreground" title={repositoryInspection.commit}>
                    {repositoryBranch.trim()} · {repositoryInspection.commit.slice(0, 10)}
                    {repositoryInspection.odooVersion ? ` · projet Odoo ${repositoryInspection.odooVersion}` : ""}
                  </span>
                )}
              </div>

              {repositoryInspection.status === "idle" && (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Choisis un dépôt et une branche : ses modules s’afficheront ici avec leur version et l’action prévue.
                </p>
              )}
              {repositoryInspection.status === "loading" && (
                <p className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Lecture des modules et de leurs versions…
                </p>
              )}
              {repositoryInspection.status === "error" && (
                <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-destructive">{repositoryInspection.error}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => setRepositoryInspectionAttempt((attempt) => attempt + 1)}>
                    <RefreshCcw className="h-4 w-4" />
                    Réessayer
                  </Button>
                </div>
              )}
              {repositoryInspection.status === "ready" && (
                <>
                  {!repositoryInspection.manifestsRead && repositoryReadyModules.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Versions illisibles pour ce dépôt : la compatibilité Odoo sera vérifiée pendant l’import.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-48 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        value={repositoryFilter}
                        onChange={(event) => setRepositoryFilter(event.target.value)}
                        placeholder={`Filtrer les ${repositoryReadyModules.length} modules`}
                        aria-label="Filtrer les modules du dépôt"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!repositorySelectableModules.length}
                      onClick={() => setRepositorySelection(new Set(repositorySelectableModules.map((module) => module.name)))}
                    >
                      Tout sélectionner ({repositorySelectableModules.length})
                    </Button>
                    {repositoryUpdatableModules.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRepositorySelection(new Set(repositoryUpdatableModules.map((module) => module.name)))}
                      >
                        Seulement les mises à jour ({repositoryUpdatableModules.length})
                      </Button>
                    )}
                    {repositorySelection.size > 0 && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRepositorySelection(new Set())}>
                        <X className="h-4 w-4" />
                        Désélectionner
                      </Button>
                    )}
                  </div>

                  {repositoryVisibleModules.length ? (
                    <>
                      {repositoryVisibleSelectable.length > 0 && (
                        <div className="divide-y rounded-md border">
                          {repositoryVisibleSelectable.slice(0, REPOSITORY_PICKER_MAX_ROWS).map((module) => repositoryModuleRow(module))}
                          {repositoryVisibleSelectable.length > REPOSITORY_PICKER_MAX_ROWS && (
                            <p className="px-3 py-2 text-xs text-muted-foreground">
                              {REPOSITORY_PICKER_MAX_ROWS} modules affichés sur {repositoryVisibleSelectable.length} : affine le filtre pour voir les autres.
                            </p>
                          )}
                        </div>
                      )}
                      {repositoryVisibleBlocked.length > 0 && (
                        // Replié par défaut : ces modules ne demandent aucune décision.
                        <details className="group rounded-md border" open={!repositoryVisibleSelectable.length}>
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-hover">
                            <span className="font-medium">Non importables ({repositoryVisibleBlocked.length})</span>
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                              Déjà fournis par le projet ou incompatibles
                              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                            </span>
                          </summary>
                          <div className="divide-y border-t">
                            {repositoryVisibleBlocked.slice(0, REPOSITORY_PICKER_MAX_ROWS).map((module) => repositoryModuleRow(module))}
                          </div>
                        </details>
                      )}
                    </>
                  ) : (
                    <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                      {repositoryReadyModules.length ? "Aucun module ne correspond au filtre." : "Aucun module Odoo trouvé dans ce dépôt."}
                    </p>
                  )}
                </>
              )}
            </section>
          </div>

          <div className="flex flex-col gap-3 border-t bg-muted/30 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {repositorySelectedModules.length > 0 && (
                <span className="block font-medium text-foreground">
                  {[
                    repositorySelectedAdds && `${repositorySelectedAdds} ajout(s)`,
                    repositorySelectedUpdates && `${repositorySelectedUpdates} mise(s) à jour`,
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
              {repositorySelectedUpdates > 0 ? "Les versions remplacées sont sauvegardées ; " : ""}
              {repositorySelectedUpdates > 0 ? "tout est annulé si un module échoue." : "Tout est annulé si un module échoue."}
            </p>
            <div className="flex shrink-0 justify-end gap-2">
              <Button variant="outline" onClick={() => setRepositoryOpen(false)}>Annuler</Button>
              <Button
                disabled={repositorySubmitting || !selectedProjectReady || repositoryInspection.status !== "ready" || !repositorySelectedModules.length}
                onClick={submitRepositoryModules}
              >
                {repositorySubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                {repositorySubmitting
                  ? "Lancement…"
                  : repositorySelectedModules.length
                    ? `Importer ${repositorySelectedModules.length} module(s)`
                    : "Importer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={zipDialogOpen}
        onOpenChange={(open) => {
          setZipDialogOpen(open);
          if (!open) resetZipImport();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importer un ZIP de modules</DialogTitle>
            <DialogDescription>
              Analyse l’archive, choisis les modules à copier dans addons-store, puis confirme l’import.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <FilePicker
              ref={zipInputRef}
              accept=".zip"
              file={zipFile}
              buttonLabel="Choisir un ZIP"
              disabled={loading || inspectingZip}
              onChange={(event) => void inspectZipFile(event.target.files?.[0])}
            />
            {inspectingZip && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyse sécurisée de l’archive…
              </div>
            )}
            {!inspectingZip && zipModuleCandidates.length > 0 && (
              <div className="min-w-0 rounded-md border">
                <label className="flex cursor-pointer items-start gap-3 border-b bg-muted/40 p-3 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={
                      selectedZipModules.size > 0 && selectedZipModules.size < zipModuleCandidates.length
                        ? "indeterminate"
                        : selectedZipModules.size === zipModuleCandidates.length
                    }
                    onCheckedChange={(checked) => toggleAllZipModules(checked === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">Sélectionner tous les modules détectés</span>
                    <span className="block text-xs text-muted-foreground">
                      {selectedZipModules.size}/{zipModuleCandidates.length} module(s) sélectionné(s)
                    </span>
                  </span>
                </label>
                <div className="max-h-64 overflow-y-auto p-2">
                  {zipModuleCandidates.map((moduleName) => (
                    <label
                      key={moduleName}
                      className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md p-2 text-sm hover:bg-hover"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={selectedZipModules.has(moduleName)}
                        onCheckedChange={(checked) => toggleZipModule(moduleName, checked === true)}
                      />
                      <span className="min-w-0 break-all font-mono">{moduleName}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <Checkbox
                className="mt-1"
                checked={replaceZipModules}
                onCheckedChange={(checked) => setReplaceZipModules(checked === true)}
              />
              <span>
                <span className="block font-medium">Remplacer les modules existants</span>
                <span className="block text-xs text-muted-foreground">
                  L’ancien dossier ou lien est sauvegardé dans `.odoo_manager_backups` avant remplacement.
                </span>
              </span>
            </label>
            <Button onClick={importZip} disabled={loading || inspectingZip || !selectedZipModules.size}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
              Importer {selectedZipModules.size || ""} module(s)
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      <Dialog open={neutralizeDbOpen} onOpenChange={setNeutralizeDbOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neutraliser {selectedDb || "la base"}</DialogTitle>
            <DialogDescription>
              Odoo sera arrêté brièvement. Tous les crons métier, dont le contrôle d’abonnement,
              ainsi que les serveurs de messagerie entrants et sortants seront désactivés.
              Sur les versions récentes, Odoo efface aussi les identifiants SMTP. Cette opération
              n’est pas réversible automatiquement.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
            À utiliser uniquement sur une copie locale ou une base de test, jamais sur la production.
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setNeutralizeDbOpen(false)}>Annuler</Button>
            <Button
              disabled={!selectedProject || !canUseDb || loading}
              onClick={async () => {
                const job = await createJob("neutralize_database", {
                  project: selectedProject?.name,
                  db: selectedDb,
                });
                if (job) setNeutralizeDbOpen(false);
              }}
            >
              <ShieldCheck className="h-4 w-4" />
              Confirmer la neutralisation
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer {selectedProject?.name}</DialogTitle>
            <DialogDescription>Le projet sera déplacé dans `.odoo_manager_deleted`. Saisis le nom du projet pour confirmer.</DialogDescription>
          </DialogHeader>
          <Input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder={selectedProject?.name} />
          <Button
            variant="destructive"
            disabled={!selectedProject || deleteConfirm !== selectedProject.name}
            onClick={async () => {
              await createJob("delete_project", { project: selectedProject?.name });
              setDeleteConfirm("");
              setDeleteDialogOpen(false);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Supprimer
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={updateAllDialogOpen}
        onOpenChange={(open) => {
          setUpdateAllDialogOpen(open);
          if (!open) {
            setAllowMissingFilestore(false);
            setUpdateFilestoreStatus(null);
            setUpdatePendingModules([]);
            setUpdateLocalExcludedModules([]);
            setMissingModulesToIgnore(new Set());
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>MAJ complète Odoo</DialogTitle>
            <DialogDescription>
              Choisis la portée de l’opération. Les modules détectés après le dernier import SSH sont proposés en priorité.
            </DialogDescription>
          </DialogHeader>
          {detectedImportedModules.length ? (
            <div className="grid gap-3 rounded-md border bg-muted/35 p-3 sm:grid-cols-2">
              <button
                type="button"
                className={cn(
                  "rounded-md border p-3 text-left text-sm transition-colors",
                  updateScope === "imported" ? "border-primary bg-selected ring-1 ring-primary/25" : "bg-background hover:bg-hover",
                )}
                onClick={() => setUpdateScope("imported")}
              >
                <span className="block font-medium">Modules importés détectés</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Installer ou mettre à jour uniquement {detectedImportedModules.length} module(s).
                </span>
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md border p-3 text-left text-sm transition-colors",
                  updateScope === "all" ? "border-primary bg-selected ring-1 ring-primary/25" : "bg-background hover:bg-hover",
                )}
                onClick={() => setUpdateScope("all")}
              >
                <span className="block font-medium">Forcer la MAJ complète</span>
                <span className="mt-1 block text-xs text-muted-foreground">Exécuter la mise à jour de l’ensemble des modules installés.</span>
              </button>
              {updateScope === "imported" && (
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto sm:col-span-2">
                  {detectedImportedModules.map((moduleName) => (
                    <Badge key={moduleName} variant="outline" className="bg-background font-mono">{moduleName}</Badge>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <div className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="grid gap-1">
              <span className="text-xs font-medium uppercase text-muted-foreground">Projet</span>
              <span className="break-words font-medium">{selectedProject?.name || "-"}</span>
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-medium uppercase text-muted-foreground">Base</span>
              <span className="break-words font-medium">{selectedDb || "-"}</span>
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-medium uppercase text-muted-foreground">Commande</span>
              <code className="break-all rounded bg-slate-950 px-2 py-1 text-xs text-emerald-100">
                {updateScope === "imported" && detectedImportedModules.length
                  ? `odoo -d ${selectedDb || "BASE"} -i/-u ${detectedImportedModules.join(",")} --stop-after-init`
                  : `odoo -d ${selectedDb || "BASE"} -u ${updateLocalExcludedModules.length ? "<modules disponibles non exclus>" : "all"} --stop-after-init`}
              </code>
            </div>
          </div>
          {updateScope === "all" && updateLocalExcludedModules.length ? (
            <div className="grid gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-800 dark:bg-blue-950/45 dark:text-blue-100">
              <div className="font-medium">Mode avec exceptions locales</div>
              <p>
                Le gestionnaire utilisera une liste explicite des modules dont le code est disponible. Les modules suivants ne seront pas remis en
                attente par un nouvel appel à <code>-u all</code> :
              </p>
              <div className="flex flex-wrap gap-1.5">
                {updateLocalExcludedModules.map((moduleName) => (
                  <Badge key={moduleName} variant="outline" className="border-blue-300 bg-white font-mono text-blue-950 dark:border-blue-700 dark:bg-blue-950/70 dark:text-blue-100">
                    {moduleName}
                  </Badge>
                ))}
              </div>
              <Button variant="outline" className="border-blue-300 bg-white hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/70 dark:hover:bg-blue-900/70" onClick={restoreLocalModuleExclusions} disabled={loading}>
                <RefreshCcw className="h-4 w-4" />
                Réactiver toutes les exclusions
              </Button>
            </div>
          ) : null}
          {updateScope === "all" && pendingModulesWithAvailableCode.length ? (
            <div className="grid gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-800 dark:bg-blue-950/45 dark:text-blue-100">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="grid gap-1">
                  <span className="font-medium">Opérations Odoo à terminer</span>
                  <span>
                    Une installation ou une mise à jour précédente a laissé {pendingModulesWithAvailableCode.length} module(s) en attente. Leur code est présent : la mise à jour complète peut les reprendre automatiquement.
                  </span>
                </div>
              </div>
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {pendingModulesWithAvailableCode.map((module) => (
                  <Badge key={module.name} variant="outline" className="border-blue-300 bg-white font-mono text-blue-950 dark:border-blue-700 dark:bg-blue-950/70 dark:text-blue-100">
                    {module.name} · {module.state}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          {updateScope === "all" && pendingModulesWithMissingCode.length ? (
            <div className="grid gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950/45 dark:text-red-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div className="grid gap-1">
                  <span className="font-medium">Code source manquant pour {pendingModulesWithMissingCode.length} module(s)</span>
                  <span>
                    Odoo avait prévu de les installer, mettre à jour ou supprimer, mais leur dossier n’existe plus dans le projet. Restaure leur code si tu veux conserver l’opération. Sur une copie locale de test, tu peux aussi annuler leur opération sans désinstaller les modules déjà actifs.
                  </span>
                  <span>
                    Les modules qui en dépendent seront détectés et exclus automatiquement de cette mise à jour locale afin de conserver un ensemble cohérent.
                  </span>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-red-200 bg-white px-3 py-2 font-medium dark:border-red-800 dark:bg-red-950/55">
                <Checkbox
                  color="red"
                  checked={someMissingPendingModulesSelected ? "indeterminate" : allMissingPendingModulesSelected}
                  disabled={loading}
                  onCheckedChange={(checked) => toggleAllMissingModulesToIgnore(checked === true)}
                />
                Tout sélectionner ({pendingModulesWithMissingCode.length})
              </label>
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-red-200 bg-white p-2 dark:border-red-800 dark:bg-red-950/55">
                {pendingModulesWithMissingCode.map((module) => (
                  <label key={module.name} className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-red-50 dark:hover:bg-red-900/50">
                    <Checkbox
                      color="red"
                      checked={missingModulesToIgnore.has(module.name)}
                      onCheckedChange={(checked) => toggleMissingModuleToIgnore(module.name, checked === true)}
                    />
                    <span className="min-w-0 flex-1 break-all font-mono text-xs">{module.name}</span>
                    <Badge className="shrink-0" variant="destructive">{module.state} · code absent</Badge>
                  </label>
                ))}
              </div>
              <Button
                variant="destructive"
                disabled={!missingModulesToIgnore.size || loading}
                onClick={ignoreSelectedMissingModulesLocally}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageX className="h-4 w-4" />}
                Annuler localement {missingModulesToIgnore.size || "la sélection"} opération(s)
              </Button>
              <p className="text-xs text-red-800 dark:text-red-200">
                Cette action ne désinstalle aucun module et ne supprime aucune donnée. Le détail des exclusions automatiques apparaîtra dans les logs.
              </p>
            </div>
          ) : null}
          {updateScope === "all" && updateFilestoreStatus && updateFilestoreStatus.missing > 0 ? (
            <div className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="grid gap-1">
                  <span className="font-medium">Filestore incomplet</span>
                  <span>
                    {updateFilestoreStatus.missing.toLocaleString("fr-FR")} fichier(s) manquent. Leur téléchargement n&apos;est pas nécessaire pour
                    mettre à jour les modules : aucune référence ne sera supprimée, mais les médias absents resteront indisponibles.
                  </span>
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-300 bg-white p-3 hover:bg-amber-100/60 dark:border-amber-800 dark:bg-amber-950/55 dark:hover:bg-amber-900/50">
                <Checkbox
                  className="mt-0.5"
                  checked={allowMissingFilestore}
                  onCheckedChange={(checked) => setAllowMissingFilestore(checked === true)}
                />
                <span className="font-medium">Continuer sans télécharger le filestore</span>
              </label>
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setUpdateAllDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              disabled={
                !selectedProjectReady ||
                !canUseDb ||
                loading ||
                checkingUpdatePrerequisites ||
                Boolean(updateScope === "all" && pendingModulesWithMissingCode.length) ||
                Boolean(updateScope === "all" && updateFilestoreStatus?.missing && !allowMissingFilestore)
              }
              onClick={confirmUpdateAllOdooModules}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              {updateScope === "imported" && detectedImportedModules.length ? "Traiter les modules importés" : "Lancer la MAJ complète"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingTranslationResetModules.length > 0}
        onOpenChange={(open) => {
          if (!open) setPendingTranslationResetModules([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réinitialiser les traductions</DialogTitle>
            <DialogDescription>
              Les modules sont mis à jour sur {selectedDb || "la base sélectionnée"} avec <code className="text-xs">--i18n-overwrite</code> :
              les traductions sont rechargées depuis les fichiers <code className="text-xs">.po</code> du code.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
            Les traductions modifiées à la main dans Odoo pour ces modules seront écrasées.
          </div>
          <div className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
            {pendingTranslationResetModules.map((name) => (
              <div key={name}>{name}</div>
            ))}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setPendingTranslationResetModules([])}>Annuler</Button>
            <Button disabled={!canUseDb || loading} onClick={confirmTranslationReset}>
              <Languages className="h-4 w-4" />
              Réinitialiser ({pendingTranslationResetModules.length})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={allTranslationsOpen} onOpenChange={setAllTranslationsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réinitialiser les traductions · {selectedDb || "base"}</DialogTitle>
            <DialogDescription>
              Recharge les termes de <strong>tous les modules installés</strong> depuis leurs fichiers <code className="text-xs">.po</code>,
              comme l’option « Écraser les termes existants » de Paramètres › Traductions › Langues. Les données et les vues ne sont
              pas mises à jour. Odoo sera arrêté brièvement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-medium">Langues</div>
            {translationLanguages === null ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lecture des langues installées…
              </p>
            ) : translationLanguages.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {translationLanguages.map((language) => (
                  <label key={language.code} className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm hover:bg-hover">
                    <Checkbox
                      checked={selectedTranslationLanguages.has(language.code)}
                      onCheckedChange={(checked) =>
                        setSelectedTranslationLanguages((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(language.code);
                          else next.delete(language.code);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{language.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{language.code}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune langue active trouvée dans la base.</p>
            )}
          </div>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
            Les traductions modifiées à la main dans Odoo seront écrasées pour les langues sélectionnées.
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setAllTranslationsOpen(false)}>Annuler</Button>
            <Button disabled={!canUseDb || loading || !selectedTranslationLanguages.size} onClick={confirmAllTranslationsReset}>
              <Languages className="h-4 w-4" />
              Réinitialiser ({selectedTranslationLanguages.size} langue{selectedTranslationLanguages.size > 1 ? "s" : ""})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={adminPasswordOpen} onOpenChange={setAdminPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mot de passe administrateur · {selectedDb || "base"}</DialogTitle>
            <DialogDescription>
              Remplace le mot de passe de l’utilisateur <code className="text-xs">base.user_admin</code> et le réactive si besoin.
              Odoo sera arrêté brièvement. L’identifiant de connexion est affiché dans les logs de la tâche.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-2 text-sm">
            <span>Nouveau mot de passe</span>
            <Input
              value={adminPassword}
              autoComplete="off"
              maxLength={128}
              onChange={(event) => setAdminPassword(event.target.value)}
            />
          </label>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
            À utiliser uniquement sur une copie locale ou une base de test.
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setAdminPasswordOpen(false)}>Annuler</Button>
            <Button disabled={!canUseDb || loading || !adminPassword.trim()} onClick={confirmAdminPasswordReset}>
              <KeyRound className="h-4 w-4" />
              Réinitialiser
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(jobToCancel)} onOpenChange={(open) => { if (!open) setJobToCancelId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{jobToCancel?.status === "queued" ? "Retirer l'action de la file d'attente" : "Arrêter l'action"}</DialogTitle>
            <DialogDescription className="break-words">{jobToCancel?.title}</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            {jobToCancel?.status === "queued"
              ? "L'action n'a pas encore démarré : elle est simplement retirée, rien n'est modifié."
              : jobToCancel?.cancel_hint}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setJobToCancelId(null)}>Laisser continuer</Button>
            <Button variant="destructive" disabled={!jobToCancel?.cancellable} onClick={confirmCancelJob}>
              {jobToCancel?.status === "queued" ? <X className="h-4 w-4" /> : <Square className="h-3.5 w-3.5 fill-current" />}
              {jobToCancel?.status === "queued" ? "Retirer" : "Arrêter"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={uninstallDialogOpen} onOpenChange={setUninstallDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Désinstaller les modules</DialogTitle>
            <DialogDescription>
              Cette action désinstalle les modules de la base {selectedDb || "sélectionnée"}. Les dossiers addons et les liens symboliques ne seront pas
              supprimés.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
            {pendingUninstallModules.map((name) => (
              <div key={name}>{name}</div>
            ))}
          </div>
          <Button variant="destructive" disabled={!pendingUninstallModules.length || loading} onClick={confirmUninstall}>
            <Trash2 className="h-4 w-4" />
            Confirmer la désinstallation
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteCodeDialogOpen} onOpenChange={setDeleteCodeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer les modules du projet</DialogTitle>
            <DialogDescription>
              Cette action retire les modules de `odoo/addons` et supprime le dossier géré dans `odoo/addons-store`.
              Les anciens imports encore liés depuis `.odoo_manager_imports` restent aussi nettoyés.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
            {pendingDeleteCodeModules.map((name) => (
              <div key={name}>{name}</div>
            ))}
          </div>
          <label className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <Checkbox
              className="mt-1"
              checked={deleteCodeUninstallFirst}
              disabled={!canUseDb}
              onCheckedChange={(checked) => setDeleteCodeUninstallFirst(checked === true)}
            />
            <span>
              <span className="block font-medium">Désinstaller de la base avant suppression</span>
              <span className="block text-xs text-muted-foreground">
                Recommandé si la base sélectionnée contient encore le module installé.
              </span>
            </span>
          </label>
          <Button variant="destructive" disabled={!pendingDeleteCodeModules.length || loading} onClick={confirmDeleteCode}>
            <PackageX className="h-4 w-4" />
            Confirmer la suppression du projet
          </Button>
        </DialogContent>
      </Dialog>

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
