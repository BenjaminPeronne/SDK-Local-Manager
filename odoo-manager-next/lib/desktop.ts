import type { WslStatus } from "./wsl-setup";

export interface DesktopBridge {
  getVersion(): Promise<string>;
  backendEndpoint(): Promise<string>;
  backendDiagnostics(): Promise<{ log_path: string; details: string }>;
  openExternalUrl(url: string): Promise<void>;
  openDockerDesktop(): Promise<void>;
  /** Backend réellement utilisé, et pourquoi l'environnement Linux a été écarté. */
  backendMode?(): Promise<{ wsl: boolean; degradedReason: string }>;
  pickDirectory(defaultPath?: string): Promise<string | null>;
  notificationsSupported(): Promise<boolean>;
  notify(title: string, body: string): Promise<void>;
  rikaCredentials(): Promise<StoredRikaCredentials>;
  saveRikaCredentials(login: string, password: string | null): Promise<void>;
  clearRikaCredentials(): Promise<void>;
  gitlabStatus(): Promise<GitLabStatus>;
  gitlabConnect(token: string): Promise<GitLabStatus>;
  gitlabDisconnect(): Promise<GitLabStatus>;
  gitlabProjects(search: string): Promise<GitLabProject[]>;
  gitlabRefs(projectId: number, search: string): Promise<GitLabRefs>;
  // Environnement Linux sous Windows : absent des autres systèmes.
  wslStatus?(): Promise<WslStatus>;
  wslInstallWsl?(): Promise<{ ok: boolean; rebootRequired: boolean; message: string }>;
  wslPrepare?(): Promise<WslStatus>;
  wslLegacyWorkspace?(): Promise<string>;
  relaunch?(): Promise<void>;
  stopLegacyTraefik?(): Promise<{ ok: boolean; message: string }>;
  wslImportSshKey?(): Promise<{ ok: boolean; key: string; alreadyPresent?: boolean }>;
  wslOpenEditor?(project: string): Promise<void>;
  wslOpenExplorer?(project: string): Promise<void>;
  /** S'abonne à l'avancement de la préparation ; la fonction rendue se désabonne. */
  onWslProgress?(callback: (step: WslPrepareStep) => void): () => void;
}

/** Étape en cours de la préparation du poste, telle que l'écran l'affiche. */
export interface WslPrepareStep {
  step: "import" | "backend" | "provision" | "done";
  label: string;
  index: number;
  total: number;
}

export type { WslStatus } from "./wsl-setup";

export interface GitLabStatus {
  available: boolean;
  reason: string;
  connected: boolean;
  /** Jeton enregistré mais indéchiffrable : le compte est à reconnecter. */
  unreadable?: boolean;
  username: string;
  url: string;
}

export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  sshUrl: string;
  defaultBranch: string;
  lastActivityAt: string;
}

export interface GitLabRefs {
  branches: { name: string; default: boolean }[];
  tags: string[];
}

export interface StoredRikaCredentials {
  available: boolean;
  reason: string;
  login: string;
  password: string;
}

declare global {
  interface Window {
    sdkDesktop?: DesktopBridge;
  }
}

/** Message d'une erreur du pont natif, sans l'enveloppe technique ajoutée par Electron. */
export function desktopErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || fallback;
}

export function desktopBridge() {
  return typeof window === "undefined" ? undefined : window.sdkDesktop;
}
