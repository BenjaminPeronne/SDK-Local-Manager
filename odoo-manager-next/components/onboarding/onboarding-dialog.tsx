"use client";

import { Activity, Boxes, CloudDownload, FolderPlus, GitBranch, KeyRound, Loader2, Play } from "lucide-react";
import { desktopBridge, desktopErrorMessage } from "@/lib/desktop";
import { isJobUnfinished } from "@/lib/jobs";
import type { Job, Overview, ProjectCreationPrerequisites, SystemStatus, Toast } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrerequisiteRow } from "@/components/projects/create-project-dialog";

type OnboardingDialogProps = {
  completeOnboarding: () => Promise<void>;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  creationPrerequisites: ProjectCreationPrerequisites | null;
  jobs: Job[];
  loadCreationPrerequisites: () => Promise<ProjectCreationPrerequisites | null>;
  loading: boolean;
  loadingCreationPrerequisites: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  openCreateProjectDialog: () => void;
  openSshAssistant: (regenerate?: boolean) => Promise<void>;
  overview: Overview | null;
  pushToast: (kind: Toast["kind"], message: string) => void;
  requestDockerStart: () => Promise<void>;
  requestTraefikInstall: () => Promise<void>;
  schedule: (callback: () => void | Promise<void>, delay: number) => void;
  systemStatus: SystemStatus | null;
  traefikInstallRunning: boolean;
};

export function OnboardingDialog({ completeOnboarding, createJob, creationPrerequisites, jobs, loadCreationPrerequisites, loading, loadingCreationPrerequisites, onOpenChange, open, openCreateProjectDialog, openSshAssistant, overview, pushToast, requestDockerStart, requestTraefikInstall, schedule, systemStatus, traefikInstallRunning }: OnboardingDialogProps) {
  const gitInstallRunning = jobs.some((job) => isJobUnfinished(job) && job.title === "Installer Git pour Windows");
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
  async function requestGitInstall() {
    if (gitInstallRunning) return;
    const job = await createJob("install_git");
    if (!job) return;
    const refreshPrerequisites = async () => { await loadCreationPrerequisites(); };
    schedule(refreshPrerequisites, 3000);
    schedule(refreshPrerequisites, 10000);
    schedule(refreshPrerequisites, 25000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onOpenChange(false);
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
              onOpenChange(false);
              openCreateProjectDialog();
            }}
          >
            <FolderPlus className="h-4 w-4" />
            Créer mon premier projet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
