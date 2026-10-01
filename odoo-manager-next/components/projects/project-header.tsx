"use client";

import { type Dispatch, type ReactNode, type RefObject, type SetStateAction, useMemo } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import { Bug, ChevronDown, ExternalLink, FileCode, Loader2, Mail, Play, RefreshCcw, Square } from "lucide-react";
import { openExternalUrl } from "@/lib/desktop-runtime";
import { isJobActive, MIGRATION_JOB_PREFIX } from "@/lib/jobs";
import { odooAccessUrl, type OdooDebugMode } from "@/lib/projects";
import type { Job, MailpitStatus, Project, Toast } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ProjectHeaderProps = {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  jobs: Job[];
  loading: boolean;
  mailpit: MailpitStatus | undefined;
  openingOdoo: boolean;
  pendingSelectedProjectArrival: Job | undefined;
  projectHeaderCompact: boolean;
  projectHeaderRef: RefObject<HTMLElement | null>;
  pushToast: (kind: Toast["kind"], message: string) => void;
  refreshAllViews: () => Promise<void>;
  refreshOverview: () => Promise<void>;
  refreshSystemStatus: () => Promise<void>;
  schedule: (callback: () => void | Promise<void>, delay: number) => void;
  selectedDb: string;
  selectedProject: Project | undefined;
  selectedProjectOnline: boolean;
  selectedProjectReady: boolean;
  setOpeningOdoo: Dispatch<SetStateAction<boolean>>;
  stickyHeader: boolean;
  /** Barre d'onglets de l'interface affinée, posée dans l'en-tête à côté des actions. */
  tabs?: ReactNode;
};

export function ProjectHeader({
  createJob,
  jobs,
  loading,
  mailpit,
  openingOdoo,
  pendingSelectedProjectArrival,
  projectHeaderCompact,
  projectHeaderRef,
  pushToast,
  refreshAllViews,
  refreshOverview,
  refreshSystemStatus,
  schedule,
  selectedDb,
  selectedProject,
  selectedProjectOnline,
  selectedProjectReady,
  setOpeningOdoo,
  stickyHeader,
  tabs,
}: ProjectHeaderProps) {
  const pendingSelectedArrivalIsMigration = Boolean(
    pendingSelectedProjectArrival?.title.startsWith(MIGRATION_JOB_PREFIX),
  );
  const selectedProjectHasContainers = Boolean(
    selectedProject &&
    [selectedProject.odoo_status, selectedProject.postgres_status].some(
      (status) => status && status !== "absent" && status !== "docker off",
    ),
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
  async function requestOpenOdoo(debug?: OdooDebugMode) {
    if (!selectedProject || openingOdoo) return;
    setOpeningOdoo(true);
    try {
      const opened = await openExternalUrl(odooAccessUrl(selectedProject, selectedDb, debug));
      if (!opened) throw new Error("Lien impossible à ouvrir depuis l'application.");
      pushToast(
        "success",
        debug
          ? "La base Odoo a été ouverte en mode debug dans le navigateur."
          : "La base Odoo a été ouverte dans le navigateur.",
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible d'ouvrir Odoo.");
    } finally {
      setOpeningOdoo(false);
    }
  }
  async function requestOpenMailpit() {
    if (!mailpit?.url || !(await openExternalUrl(mailpit.url))) {
      pushToast("error", "Impossible d'ouvrir Mailpit.");
    }
  }
  async function requestStartMailpit() {
    await createJob("start_mailpit");
  }

  const actionWidth = tabs ? undefined : "w-full";
  const projectState = selectedProjectStarting
    ? { label: "Démarrage…", tone: "busy" }
    : selectedProjectStopping
      ? { label: "Arrêt…", tone: "busy" }
      : selectedProjectOnline
        ? { label: "Démarré", tone: "on" }
        : { label: "Arrêté", tone: "off" };
  const titleBlock = (
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
        ) : (
          selectedProject?.odoo_version && (
            <Badge className="mt-0.5 shrink-0" variant="outline">
              Odoo {selectedProject.odoo_version}
            </Badge>
          )
        )}
        {tabs && selectedProject && !pendingSelectedProjectArrival && (
          <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 rounded-full",
                projectState.tone === "on" && "bg-emerald-500",
                projectState.tone === "busy" && "animate-pulse bg-amber-500",
                projectState.tone === "off" && "bg-muted-foreground/45",
              )}
            />
            {projectState.label}
          </span>
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
  );
  const startStopButton = selectedProjectOnline ? (
    <Button
      key="stop-project"
      className={actionWidth}
      variant="destructive"
      disabled={
        !selectedProjectReady || !selectedProjectHasContainers || loading || Boolean(selectedProjectLifecycleJob)
      }
      onClick={requestStopProject}
    >
      {selectedProjectStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
      {selectedProjectStopping ? "Arrêt…" : "Arrêter"}
    </Button>
  ) : (
    <Button
      key="start-project"
      className={actionWidth}
      disabled={!selectedProjectReady || loading || Boolean(selectedProjectLifecycleJob)}
      onClick={requestStartProject}
    >
      {selectedProjectStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {selectedProjectStarting ? "Démarrage…" : "Démarrer"}
    </Button>
  );
  const openOdooGroup = selectedProject && (
    // Le bouton désactivé ne reçoit pas le survol : l'explication est portée par son conteneur.
    <div className="col-span-2 flex sm:col-span-1">
      <span
        className="flex min-w-0 flex-1"
        title={selectedProjectOnline ? undefined : "Démarre le projet pour ouvrir Odoo."}
      >
        <Button
          className="w-full whitespace-nowrap rounded-r-none px-3"
          variant="outline"
          disabled={!selectedProjectReady || !selectedProjectOnline || openingOdoo}
          onClick={() => requestOpenOdoo()}
        >
          {openingOdoo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          {openingOdoo ? "Ouverture…" : "Ouvrir Odoo"}
        </Button>
      </span>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger>
          <Button
            className="-ml-px w-8 shrink-0 rounded-l-none px-0"
            variant="outline"
            disabled={!selectedProjectReady}
            title="Mode debug et e-mails"
            aria-label="Autres façons d’ouvrir Odoo"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" className="min-w-64">
          <DropdownMenu.Label>Ouvrir Odoo</DropdownMenu.Label>
          <DropdownMenu.Item disabled={!selectedProjectOnline || openingOdoo} onSelect={() => requestOpenOdoo("1")}>
            <Bug className="h-4 w-4" />
            En mode debug
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!selectedProjectOnline || openingOdoo}
            onSelect={() => requestOpenOdoo("assets")}
          >
            <FileCode className="h-4 w-4" />
            En mode debug avec assets
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Label>E-mails des bases neutralisées</DropdownMenu.Label>
          {mailpit?.running ? (
            <DropdownMenu.Item onSelect={requestOpenMailpit}>
              <Mail className="h-4 w-4" />
              Voir les e-mails (Mailpit)
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item disabled={!mailpit?.can_start || loading} onSelect={requestStartMailpit}>
              <Mail className="h-4 w-4" />
              {mailpit?.installed ? "Démarrer Mailpit" : "Installer Mailpit"}
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );

  if (tabs) {
    return (
      <header
        ref={projectHeaderRef}
        className={cn("sdk-project-header border-b", stickyHeader && "lg:sticky lg:top-0 lg:z-30")}
      >
        <div
          className={cn(
            "px-4 pt-4 transition-[padding] duration-200 motion-reduce:transition-none sm:px-6",
            projectHeaderCompact && "lg:pt-2.5",
          )}
        >
          {titleBlock}
          <div className="mt-3 flex flex-col-reverse gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
            <div className="min-w-0 overflow-x-auto">{tabs}</div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 lg:pb-2">
              <Button
                size="icon"
                variant="outline"
                title="Actualiser"
                aria-label="Actualiser"
                onClick={refreshAllViews}
              >
                <RefreshCcw className="h-4 w-4" />
              </Button>
              {startStopButton}
              {openOdooGroup}
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header
      ref={projectHeaderRef}
      className={cn("sdk-project-header border-b bg-card", stickyHeader && "lg:sticky lg:top-0 lg:z-30 lg:shadow-sm")}
    >
      <div
        className={cn(
          "mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 transition-[padding] duration-200 motion-reduce:transition-none xl:flex-row xl:items-start xl:justify-between",
          projectHeaderCompact && "lg:gap-3 lg:py-2 xl:items-center",
        )}
      >
        {titleBlock}
        <div className="grid w-full shrink-0 grid-cols-2 items-stretch gap-2 sm:grid-cols-3 xl:w-[540px]">
          <Button className="w-full" variant="outline" onClick={refreshAllViews}>
            <RefreshCcw className="h-4 w-4" />
            Actualiser
          </Button>
          {startStopButton}
          {openOdooGroup}
        </div>
      </div>
    </header>
  );
}
