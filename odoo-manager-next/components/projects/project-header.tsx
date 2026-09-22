"use client";

import { type Dispatch, type RefObject, type SetStateAction, useMemo } from "react";
import { ExternalLink, Loader2, Play, RefreshCcw, Square } from "lucide-react";
import { openExternalUrl } from "@/lib/desktop-runtime";
import { isJobActive, MIGRATION_JOB_PREFIX } from "@/lib/jobs";
import { odooAccessUrl } from "@/lib/projects";
import type { Job, Project, Toast } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ProjectHeaderProps = {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  jobs: Job[];
  loading: boolean;
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
};

export function ProjectHeader({ createJob, jobs, loading, openingOdoo, pendingSelectedProjectArrival, projectHeaderCompact, projectHeaderRef, pushToast, refreshAllViews, refreshOverview, refreshSystemStatus, schedule, selectedDb, selectedProject, selectedProjectOnline, selectedProjectReady, setOpeningOdoo, stickyHeader }: ProjectHeaderProps) {
  const pendingSelectedArrivalIsMigration = Boolean(pendingSelectedProjectArrival?.title.startsWith(MIGRATION_JOB_PREFIX));
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
  const selectedOdooUrl = odooAccessUrl(selectedProject, selectedDb);
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

  return (
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
  );
}
