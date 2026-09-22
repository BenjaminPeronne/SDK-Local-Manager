type InterfaceIcon = "manager" | "local";

export type Project = {
  name: string;
  odoo_status: string;
  postgres_status: string;
  odoo_version?: string;
  url: string;
  database_manager_url: string;
  databases: string[];
  database_versions?: Record<string, string>;
};

export type Overview = {
  workspace: string;
  docker_ok: boolean;
  docker_message: string;
  projects: Project[];
};

export type DockerStatus = {
  state: "missing" | "starting" | "stopped" | "ready" | string;
  installed: boolean;
  running: boolean;
  message: string;
  platform: string;
  execution_mode: string;
  can_start: boolean;
  version?: string;
  install_guide?: InstallGuide;
};

export type InstallGuide = {
  title: string;
  download_url: string;
  install_url: string;
  steps: string[];
};

export type TraefikStatus = {
  state: "missing" | "invalid" | "stopped" | "running" | "conflict" | string;
  path: string;
  installed: boolean;
  running: boolean;
  message: string;
  // Port HTTP réellement publié par Traefik (80 par défaut, personnalisable dans son compose).
  http_port?: number;
  container?: string;
  external?: boolean;
  repo?: string;
  requires_docker: boolean;
  can_install: boolean;
  can_start: boolean;
};

// Liens de odoo/addons créés par WSL dans les anciennes versions Windows.
export type AddonLinksStatus = {
  supported: boolean;
  wsl_links: number;
  interrupted: boolean;
  native_symlinks: boolean;
};

export type SystemStatus = {
  docker: DockerStatus;
  traefik?: TraefikStatus;
  workspace: string;
  workspace_exists: boolean;
  abandoned_staging?: { count: number; names: string[]; oldest_modified_at: number };
};

export type MigrationCandidate = {
  name: string;
  source: string;
  already_migrated: boolean;
  stopped: boolean;
  // Faux quand le verrou PostgreSQL est le seul indice : aucun moteur Docker joignable ne
  // connaît les conteneurs du projet, et un verrou survit à un conteneur tué.
  engine_confirmed: boolean;
};

export type MigrationSnapshot = {
  available: boolean;
  source: string;
  projects: MigrationCandidate[];
  dismissed: boolean;
};

export type BootstrapSnapshot = {
  overview: Overview;
  system_status: SystemStatus;
  settings: ManagerSettings;
  jobs: Job[];
};

/** Action de menu d'une base, en attente de confirmation. */
export type PendingDatabaseAction = { db: string; action: DatabaseMenuAction };

export type DatabaseMenuAction =
  "regenerate_assets" | "reset_translations" | "neutralize" | "admin_password" | "psql" | "drop";

export type ManagerSettings = {
  version: number;
  workspace: string;
  execution_mode: "native" | "wsl" | string;
  wsl_distribution: string;
  docker_executable: string;
  traefik_directory: string;
  docker_poll_interval: number;
  api_port: number;
  api_port_actual?: number;
  show_technical_details: boolean;
  sticky_header: boolean;
  interface_icon: InterfaceIcon;
  interface_layout: "classic" | "refined";
  onboarding_completed: boolean;
  /** Ancien dossier de projets Windows choisi à la main ; vide : détection automatique. */
  legacy_workspace: string;
  migration_banner_dismissed: boolean;
  beta_interface_banner_dismissed: boolean;
  config_file?: string;
  platform?: string;
  workspace_exists?: boolean;
};

export type ProjectCreationPrerequisites = {
  workspace: string;
  workspace_exists: boolean;
  workspace_ready: boolean;
  git_available: boolean;
  git_version: string;
  git_install_supported: boolean;
  git_install_message: string;
  ssh_key_present: boolean;
  ssh_keys: string[];
  ssh_keygen_available: boolean;
  tool_environment?: string;
  gitlab_ssh_keys_url: string;
  supported_versions: string[];
};

export type SshPublicKey = {
  name: string;
  public_key: string;
};

export type Job = {
  id: number;
  title: string;
  project?: string | null;
  status: "queued" | "running" | "cancelling" | "cancelled" | "done" | "error" | string;
  // Arrêt : possible maintenant, ce qu'il fera, étape irréversible qui le bloque, étape qu'il attend.
  cancellable?: boolean;
  cancel_hint?: string;
  cancel_blocked_step?: string;
  cancel_pending_step?: string;
  waiting_for?: string;
  started_at: string;
  finished_at?: string | null;
  error_message?: string;
  lines: string[];
  output?: string;
  // Présents sur le job détaillé : output_from > 0 signifie que `output` n'est que la suite.
  output_from?: number;
  output_total?: number;
  last_line?: string;
  progress?: {
    label: string;
    current?: number | null;
    total?: number | null;
  } | null;
  result?: {
    kind?: string;
    scope?: string;
    mode?: string;
    modules?: string[];
  };
};

export type RestoreDatabasePayload = {
  project: string;
  db: string;
  masterPwd: string;
  copy: boolean;
  neutralize: boolean;
  file: File;
};

export type ModuleOrigin = "enterprise" | "other";

export type ModuleInfo = {
  name: string;
  title: string;
  state: string;
  origin?: string;
  version?: string;
  installed_version?: string;
  path: string;
  source_path?: string;
  link_path?: string;
  path_kind?: string;
  removable?: boolean;
  removal_mode?: string;
  removal_note?: string;
};

export type SocleApp = {
  id: string;
  label: string;
  section: string;
  modules: string[];
  missing: string[];
  installed_modules: string[];
  extra_count: number;
};

export type SocleCatalog = {
  sections: { id: string; label: string }[];
  apps: SocleApp[];
  states_available: boolean;
};

export type PlanModule = { name: string; title: string };

type PlanBlocker = { name: string; required_by: string };

export type SocleInstallPlan = {
  requested: string[];
  already_installed: string[];
  dependencies: PlanModule[];
  auto_installed: PlanModule[];
  applications: PlanModule[];
  missing: PlanBlocker[];
  uninstallable: PlanBlocker[];
  total: number;
};

export type RepositoryModule = {
  name: string;
  path: string;
  title: string;
  version: string;
  current_version: string;
  installed_version: string;
  state: string;
  action: "add" | "update" | "blocked";
  reason: string;
  warning: string;
};

export type RepositoryInspection =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | {
      status: "ready";
      key: string;
      modules: RepositoryModule[];
      commit: string;
      odooVersion: string;
      manifestsRead: boolean;
    }
  | { status: "error"; key: string; error: string };

/** Journal affiché hors d'une action : sortie d'un import ZIP, logs bruts d'un projet. */
export type ExternalLogView = {
  title: string;
  content: string;
  project: string;
  logs?: "summary" | "full";
};

export type Toast = {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
};

type DiagnosticIssue = {
  severity: "success" | "warning" | "error" | string;
  title: string;
  details?: string;
  items?: string[];
};

export type FilestoreStatus = {
  path: string;
  referenced: number;
  referenced_unique: number;
  actual: number;
  physical_total?: number;
  missing: number;
  module_update_supported?: boolean;
};

export type PendingModuleOperation = {
  name: string;
  state: string;
  code_available: boolean;
};

export type ZipInspection = {
  modules: string[];
  ignored_symlinks: number;
};

export type BackendDiagnostics = {
  log_path: string;
  details: string;
};

export type ManagerErrorEntry = {
  id: number;
  timestamp: string;
  source: string;
  project?: string;
  message: string;
  details?: string;
};

export type ProjectDiagnostics = {
  project: string;
  docker_ok: boolean;
  odoo_status?: string;
  postgres_status?: string;
  issues: DiagnosticIssue[];
  databases?: Array<{
    name: string;
    filestore?: FilestoreStatus;
    pending_modules?: PendingModuleOperation[];
    pending_missing_modules?: string[];
    ignored_missing_modules?: string[];
    local_excluded_modules?: string[];
  }>;
};
