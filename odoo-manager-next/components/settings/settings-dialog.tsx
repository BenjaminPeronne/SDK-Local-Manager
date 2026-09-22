"use client";

import { type Dispatch, type SetStateAction, useCallback, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCcw,
  Settings,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { desktopErrorMessage, type GitLabStatus, type StoredRikaCredentials } from "@/lib/desktop";
import { openExternalUrl, pickDirectory } from "@/lib/desktop-runtime";
import { windowsPathFromMount } from "@/lib/projects";
import type {
  ManagerErrorEntry,
  ManagerSettings,
  MigrationCandidate,
  MigrationSnapshot,
  ModuleInfo,
  ProjectCreationPrerequisites,
  SshPublicKey,
  SystemStatus,
  Toast,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InteractiveCard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import appIcon from "@/app/icon.png";
import localIcon from "@/app/local-icon.png";
import { MigrationProposal } from "@/components/projects/migration-proposal";
import {
  SETTINGS_SAVED_KEYS,
  SETTINGS_SECTIONS,
  SettingsGroup,
  SettingsSection,
  type SettingsSectionId,
} from "@/components/settings/settings-section";

const GITLAB_TOKEN_URL =
  "https://gitlab.sudokeys.com/-/user_settings/personal_access_tokens?name=SDK%20Local%20Manager&scopes=read_api";

type SettingsDialogProps = {
  desktopRuntime: boolean;
  gitlabStatus: GitLabStatus | null;
  loadCreationPrerequisites: () => Promise<ProjectCreationPrerequisites | null>;
  loading: boolean;
  loadingManagerErrors: boolean;
  loadManagerErrors: () => Promise<void>;
  managerErrorLogPath: string;
  managerErrors: ManagerErrorEntry[];
  migration: MigrationSnapshot | null;
  migrationCandidates: MigrationCandidate[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  openSshAssistant: (regenerate?: boolean, provider?: "gitlab" | "github") => Promise<void>;
  pushToast: (kind: Toast["kind"], message: string) => void;
  refreshMigration: () => Promise<void>;
  refreshOverview: () => Promise<void>;
  refreshSystemStatus: () => Promise<void>;
  requestProjectMigration: (project: string, force?: boolean) => Promise<void>;
  selectedSshKey: SshPublicKey;
  setGitlabStatus: Dispatch<SetStateAction<GitLabStatus | null>>;
  setManagerErrors: Dispatch<SetStateAction<ManagerErrorEntry[]>>;
  setMigrationBannerClosed: Dispatch<SetStateAction<boolean>>;
  setModules: Dispatch<SetStateAction<ModuleInfo[]>>;
  setOnboardingOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedDb: Dispatch<SetStateAction<string>>;
  setSelectedProjectName: Dispatch<SetStateAction<string>>;
  setSettings: Dispatch<SetStateAction<ManagerSettings | null>>;
  setSettingsDraft: Dispatch<SetStateAction<ManagerSettings | null>>;
  setSettingsSection: Dispatch<SetStateAction<SettingsSectionId>>;
  setStoredRikaCredentials: Dispatch<SetStateAction<StoredRikaCredentials | null>>;
  settings: ManagerSettings | null;
  settingsDraft: ManagerSettings | null;
  settingsSection: "general" | "appearance" | "accounts" | "advanced" | "diagnostic";
  storedRikaCredentials: StoredRikaCredentials | null;
  systemStatus: SystemStatus | null;
  /** Backend dans l'environnement Linux sous Windows : la migration des anciens projets s'y applique. */
  wslBackend: boolean;
};

export function SettingsDialog({
  desktopRuntime,
  gitlabStatus,
  loadCreationPrerequisites,
  loading,
  loadingManagerErrors,
  loadManagerErrors,
  managerErrorLogPath,
  managerErrors,
  migration,
  migrationCandidates,
  onOpenChange,
  open,
  openSshAssistant,
  pushToast,
  refreshMigration,
  refreshOverview,
  refreshSystemStatus,
  requestProjectMigration,
  selectedSshKey,
  setGitlabStatus,
  setManagerErrors,
  setMigrationBannerClosed,
  setModules,
  setOnboardingOpen,
  setSelectedDb,
  setSelectedProjectName,
  setSettings,
  setSettingsDraft,
  setSettingsSection,
  setStoredRikaCredentials,
  settings,
  settingsDraft,
  settingsSection,
  storedRikaCredentials,
  systemStatus,
  wslBackend,
}: SettingsDialogProps) {
  const [savingSettings, setSavingSettings] = useState(false);
  const [selectingWorkspace, setSelectingWorkspace] = useState(false);
  const [savingLegacyWorkspace, setSavingLegacyWorkspace] = useState(false);
  const [gitlabTokenDraft, setGitlabTokenDraft] = useState("");
  const [gitlabConnecting, setGitlabConnecting] = useState(false);
  const reopenInitialConfiguration = useCallback(() => {
    onOpenChange(false);
    setOnboardingOpen(true);
    void loadCreationPrerequisites();
  }, [loadCreationPrerequisites]);
  async function copyManagerErrors() {
    const content = managerErrors
      .map((entry) =>
        [
          `[${entry.timestamp}] ${entry.source}${entry.project ? ` · ${entry.project}` : ""}`,
          entry.message,
          entry.details || "",
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n");
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
      onOpenChange(false);
      setSelectedProjectName("");
      setSelectedDb("");
      setModules([]);
      pushToast(
        "success",
        apiPortChanged
          ? "Paramètres enregistrés. Redémarre le gestionnaire pour appliquer le nouveau port."
          : "Paramètres enregistrés.",
      );
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
  /**
   * Enregistre tout de suite le dossier des anciens projets Windows, puis relit les projets à
   * copier. Une chaîne vide rétablit la détection automatique. Le brouillon garde les autres
   * modifications en cours.
   */
  async function saveLegacyWorkspace(value: string) {
    setSavingLegacyWorkspace(true);
    try {
      const payload = await api<{ settings: ManagerSettings }>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ legacy_workspace: value }),
      });
      setSettings(payload.settings);
      setSettingsDraft((draft) =>
        draft ? { ...draft, legacy_workspace: payload.settings.legacy_workspace } : payload.settings,
      );
      await refreshMigration();
      pushToast("success", value ? "Dossier des anciens projets enregistré." : "Détection automatique rétablie.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Enregistrement du dossier impossible.");
    } finally {
      setSavingLegacyWorkspace(false);
    }
  }
  async function chooseLegacyWorkspace() {
    try {
      const selected = await pickDirectory(windowsPathFromMount(migration?.source || ""));
      if (selected) await saveLegacyWorkspace(selected);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible d’ouvrir le sélecteur de dossier.");
    }
  }
  const settingsDirty = Boolean(
    settingsDraft && SETTINGS_SAVED_KEYS.some((key) => settingsDraft[key] !== (settings ? settings[key] : undefined)),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                        active
                          ? "bg-selected font-medium text-primary"
                          : "text-muted-foreground hover:bg-hover hover:text-foreground",
                      )}
                      onClick={() => setSettingsSection(section.id)}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 whitespace-nowrap">{section.label}</span>
                      {section.id === "diagnostic" && managerErrors.length > 0 && (
                        <Badge variant="warning" className="shrink-0">
                          {managerErrors.length}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </nav>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                {settingsSection === "general" && (
                  <SettingsSection
                    title="Général"
                    description="Emplacement des projets et configuration de base du poste."
                  >
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
                            {selectingWorkspace ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FolderOpen className="h-4 w-4" />
                            )}
                            Choisir
                          </Button>
                        </div>
                        <span className="text-xs font-normal leading-relaxed text-muted-foreground">
                          Le dossier est créé s’il n’existe pas encore. Dans l’application installée, « Choisir » ouvre
                          le sélecteur du système.
                        </span>
                      </div>
                    </SettingsGroup>
                    <div className="rounded-md border bg-muted/40 p-3">
                      <div className="text-sm font-medium">Exécution automatique</div>
                      <p className="mt-1 text-xs font-normal leading-relaxed text-muted-foreground">
                        Le gestionnaire choisit automatiquement les outils adaptés au système. Sous Windows, Docker, Git
                        et les chemins sont exécutés dans l’environnement compatible avec le workspace. Les chemins
                        Windows sont traduits automatiquement lorsque Docker ou Git passe par WSL.
                      </p>
                    </div>

                    {wslBackend && (
                      <SettingsGroup>
                        <div className="grid min-w-0 gap-3">
                          <div>
                            <div className="text-sm font-medium">Anciens projets Windows</div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              Dossier où l’ancienne version rangeait les projets. Il est détecté automatiquement ;
                              choisis-le si tes projets sont ailleurs, sur un autre disque ou dans un dossier déplacé.
                            </p>
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                            <code className="min-w-0 break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                              {migration?.source ? windowsPathFromMount(migration.source) : "Aucun dossier trouvé"}
                            </code>
                            <Badge variant="outline">
                              {settings?.legacy_workspace ? "Choisi manuellement" : "Détecté automatiquement"}
                            </Badge>
                          </div>
                          {migration?.available && migrationCandidates.length === 0 && (
                            <p className="text-xs text-muted-foreground">Aucun projet à copier dans ce dossier.</p>
                          )}
                          {migration?.source && !migration.available && (
                            <p className="text-xs text-muted-foreground">Ce dossier n’est plus accessible.</p>
                          )}
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={savingLegacyWorkspace}
                              onClick={() => void chooseLegacyWorkspace()}
                            >
                              {savingLegacyWorkspace ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <FolderOpen className="h-4 w-4" />
                              )}
                              Choisir le dossier…
                            </Button>
                            {settings?.legacy_workspace && (
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={savingLegacyWorkspace}
                                onClick={() => void saveLegacyWorkspace("")}
                              >
                                <RefreshCcw className="h-4 w-4" />
                                Revenir à la détection automatique
                              </Button>
                            )}
                          </div>
                        </div>
                      </SettingsGroup>
                    )}

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
                                onOpenChange(false);
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
                            Rouvre l’assistant du premier démarrage pour vérifier le workspace, Docker, Git, SSH et
                            Traefik.
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
                            L’interface affinée réorganise Bases, Modules, Activité et Réglages du projet : moins de
                            vide, colonnes alignées, survols et focus plus visibles, sortie technique dépliée à la
                            demande. Aucune action ni information n’est retirée.
                          </p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Interface">
                          {(
                            [
                              ["classic", "Classique", "Interface actuelle, inchangée."],
                              [
                                "refined",
                                "Affinée (bêta)",
                                "Nouvelle organisation des écrans Bases, Modules, Activité et Réglages.",
                              ],
                            ] as const
                          ).map(([value, title, description]) => (
                            <InteractiveCard
                              key={value}
                              role="radio"
                              aria-checked={(settingsDraft.interface_layout ?? "classic") === value}
                              className={cn(
                                "p-3 text-left",
                                (settingsDraft.interface_layout ?? "classic") === value && "border-primary bg-selected",
                              )}
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
                              settingsDraft.interface_icon === "manager" &&
                                "border-primary bg-selected ring-1 ring-primary/25",
                            )}
                            role="radio"
                            aria-checked={settingsDraft.interface_icon === "manager"}
                            onClick={() => setSettingsDraft({ ...settingsDraft, interface_icon: "manager" })}
                          >
                            <img
                              src={appIcon.src}
                              alt=""
                              aria-hidden="true"
                              className="h-14 w-14 shrink-0 rounded-[13px] object-cover"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold">SDK Local Manager</span>
                              <span className="mt-1 block text-xs text-muted-foreground">Logo Sudokeys</span>
                            </span>
                            {settingsDraft.interface_icon === "manager" && (
                              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                            )}
                          </InteractiveCard>
                          <InteractiveCard
                            className={cn(
                              "flex min-h-24 items-center gap-3 p-3",
                              settingsDraft.interface_icon === "local" &&
                                "border-primary bg-selected ring-1 ring-primary/25",
                            )}
                            role="radio"
                            aria-checked={settingsDraft.interface_icon === "local"}
                            onClick={() => setSettingsDraft({ ...settingsDraft, interface_icon: "local" })}
                          >
                            <img
                              src={localIcon.src}
                              alt=""
                              aria-hidden="true"
                              className="h-14 w-14 shrink-0 rounded-full object-cover"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold">Logo Local</span>
                              <span className="mt-1 block text-xs text-muted-foreground">Nouvelle icône</span>
                            </span>
                            {settingsDraft.interface_icon === "local" && (
                              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                            )}
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
                            Désactivé, le gestionnaire présente uniquement le voyant d’état des projets et une liste de
                            modules compacte.
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
                            Garde le nom du projet, les actions et les onglets visibles pendant le défilement. L’en-tête
                            se compacte dès que la page défile. Sur les fenêtres étroites, il reste non fixe pour
                            préserver la place.
                          </span>
                        </span>
                      </label>
                    </div>
                  </SettingsSection>
                )}

                {settingsSection === "accounts" && (
                  <SettingsSection
                    title="Comptes et accès"
                    description="Clé SSH, GitLab, GitHub et identifiants mémorisés. Ces réglages s’appliquent immédiatement, sans enregistrement."
                  >
                    <div className="grid gap-3 rounded-md border p-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">Clé SSH pour GitLab et GitHub</div>
                          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                            {selectedSshKey
                              ? `${selectedSshKey.name} · ${selectedSshKey.public_key}`
                              : "Aucune clé publique détectée dans l’environnement Git utilisé par le gestionnaire."}
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(!selectedSshKey && "sm:col-span-2")}
                          onClick={() => openSshAssistant()}
                        >
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

                    <div className="grid gap-3 rounded-md border p-3">
                      <div>
                        <div className="text-sm font-medium">Accès SSH GitHub</div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Utilise la clé publique de cet environnement Git pour accéder aux dépôts GitHub autorisés.
                          Ajoute-la à ton compte comme clé d’authentification.
                        </p>
                      </div>
                      <Button type="button" variant="outline" onClick={() => openSshAssistant(false, "github")}>
                        <KeyRound className="h-4 w-4" />
                        {selectedSshKey ? "Gérer la clé GitHub" : "Générer une clé pour GitHub"}
                      </Button>
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
                        {!gitlabStatus.available && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">{gitlabStatus.reason}</p>
                        )}
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
                            <Button
                              type="submit"
                              className="shrink-0"
                              disabled={gitlabConnecting || !gitlabTokenDraft.trim()}
                            >
                              {gitlabConnecting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <KeyRound className="h-4 w-4" />
                              )}
                              Activer
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="shrink-0"
                              onClick={() => void openExternalUrl(GITLAB_TOKEN_URL)}
                            >
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
                          onChange={(event) =>
                            setSettingsDraft({ ...settingsDraft, docker_executable: event.target.value })
                          }
                          placeholder="docker"
                        />
                      </label>

                      <label className="grid min-w-0 gap-1.5 text-sm font-medium">
                        Dossier Traefik
                        <Input
                          value={settingsDraft.traefik_directory}
                          onChange={(event) =>
                            setSettingsDraft({ ...settingsDraft, traefik_directory: event.target.value })
                          }
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
                          onChange={(event) =>
                            setSettingsDraft({ ...settingsDraft, docker_poll_interval: Number(event.target.value) })
                          }
                        />
                      </label>

                      <label className="grid gap-1.5 text-sm font-medium">
                        Port local du gestionnaire
                        <Input
                          type="number"
                          min={1024}
                          max={65535}
                          value={settingsDraft.api_port}
                          onChange={(event) =>
                            setSettingsDraft({ ...settingsDraft, api_port: Number(event.target.value) })
                          }
                        />
                        <span className="text-xs font-normal leading-relaxed text-muted-foreground">
                          Port préféré de l’API locale. Un redémarrage est nécessaire après modification. S’il est
                          occupé, notamment par Docker, le gestionnaire choisit automatiquement un port libre.
                        </span>
                      </label>
                    </SettingsGroup>
                    <div className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm">
                      <div>
                        <div className="font-medium">Ports utilisés ou contactés</div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Les ports internes Docker ne sont pas réservés sur Windows sauf publication explicite du
                          projet.
                        </p>
                      </div>
                      <div className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[100px_minmax(0,1fr)]">
                        <code>{settingsDraft.api_port_actual || settingsDraft.api_port}</code>
                        <span>
                          API locale du gestionnaire, sur <code>127.0.0.1</code> uniquement
                        </span>
                        <code>{systemStatus?.traefik?.http_port ?? 80}</code>
                        <span>
                          Traefik, accès HTTP aux projets
                          {systemStatus?.traefik?.external && systemStatus.traefik.container
                            ? ` (instance existante : ${systemStatus.traefik.container})`
                            : ""}
                        </span>
                        <code>8069</code>
                        <span>Odoo à l’intérieur de chaque conteneur</span>
                        <code>5432</code>
                        <span>PostgreSQL à l’intérieur de chaque conteneur</span>
                        <code>10022</code>
                        <span>Connexion SSH sortante vers GitLab Sudokeys</span>
                        <code>3000</code>
                        <span>Interface Next.js, uniquement en mode développement</span>
                      </div>
                      {settingsDraft.api_port_actual && settingsDraft.api_port_actual !== settingsDraft.api_port && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Le port {settingsDraft.api_port} était occupé au démarrage. Cette session utilise
                          automatiquement le port {settingsDraft.api_port_actual}.
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
                            Les erreurs d’API, de jobs et d’interface sont conservées localement. Les mots de passe,
                            jetons et secrets détectés sont masqués.
                          </p>
                          {managerErrorLogPath && (
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              Fichier : {managerErrorLogPath}
                            </p>
                          )}
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
                        ) : managerErrors.length ? (
                          managerErrors.map((entry) => (
                            <details key={entry.id} className="rounded-md border bg-card p-2 text-xs">
                              <summary className="cursor-pointer break-words font-medium">
                                {entry.timestamp} · {entry.source}
                                {entry.project ? ` · ${entry.project}` : ""}
                              </summary>
                              <p className="mt-2 whitespace-pre-wrap break-words text-destructive">{entry.message}</p>
                              {entry.details && (
                                <pre className="log-terminal mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-2 text-[11px] text-slate-100">
                                  {entry.details}
                                </pre>
                              )}
                            </details>
                          ))
                        ) : (
                          <p className="p-2 text-xs text-muted-foreground">Aucune erreur enregistrée.</p>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={loadManagerErrors}
                          disabled={loadingManagerErrors}
                        >
                          <RefreshCcw className="h-4 w-4" /> Actualiser
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={copyManagerErrors}
                          disabled={!managerErrors.length}
                        >
                          <Copy className="h-4 w-4" /> Copier
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={clearManagerErrors}
                          disabled={!managerErrors.length}
                        >
                          <Trash2 className="h-4 w-4" /> Effacer
                        </Button>
                      </div>
                    </div>
                  </SettingsSection>
                )}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p
                className={cn(
                  "text-xs",
                  settingsDirty ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground",
                )}
              >
                {settingsDirty ? "Modifications non enregistrées." : "Aucune modification en attente."}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Annuler
                </Button>
                <Button
                  disabled={
                    savingSettings ||
                    !settingsDirty ||
                    !settingsDraft.workspace.trim() ||
                    settingsDraft.api_port < 1024 ||
                    settingsDraft.api_port > 65535
                  }
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
  );
}
