"use client";

import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import { Circle, FolderPlus, Info, Loader2, Search, Settings } from "lucide-react";
import type { StaticImageData } from "next/image";
import { statusVariant } from "@/lib/format";
import { isJobActive, MIGRATION_JOB_PREFIX } from "@/lib/jobs";
import type { ExternalLogView, Job, ManagerSettings, Overview, Project, SystemStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";

type AppSidebarProps = {
  jobs: Job[];
  openCreateProjectDialog: () => void;
  openSettingsDialog: () => void;
  overview: Overview | null;
  pendingProjectArrivals: Job[];
  selectedAppIcon: StaticImageData;
  selectedProject: Project | undefined;
  selectedProjectName: string;
  selectJob: (jobId: number) => void;
  setAboutOpen: Dispatch<SetStateAction<boolean>>;
  setActiveTab: Dispatch<SetStateAction<string>>;
  setExternalLogView: Dispatch<SetStateAction<ExternalLogView | null>>;
  setSelectedDb: Dispatch<SetStateAction<string>>;
  setSelectedProjectName: Dispatch<SetStateAction<string>>;
  settings: ManagerSettings | null;
  systemStatus: SystemStatus | null;
};

export function AppSidebar({
  jobs,
  openCreateProjectDialog,
  openSettingsDialog,
  overview,
  pendingProjectArrivals,
  selectedAppIcon,
  selectedProject,
  selectedProjectName,
  selectJob,
  setAboutOpen,
  setActiveTab,
  setExternalLogView,
  setSelectedDb,
  setSelectedProjectName,
  settings,
  systemStatus,
}: AppSidebarProps) {
  const [projectsFilter, setProjectsFilter] = useState("");
  const projectLifecycleJobs = useMemo(() => {
    const runningJobs = new Map<string, Job>();
    for (const job of jobs) {
      if (isJobActive(job)) runningJobs.set(job.title, job);
    }
    return runningJobs;
  }, [jobs]);
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

  return (
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
              <div className="min-w-0">
                <p className="sdk-eyebrow">Sudokeys</p>
                <h1 className="sdk-brand-name text-sm font-extrabold leading-tight">SDK Local Manager</h1>
              </div>
            </div>
            <ThemeToggle />
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <p
              className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              title={overview?.workspace || "Workspace local"}
            >
              {overview?.workspace || "Workspace local"}
            </p>
            <Badge
              className="shrink-0"
              variant={(systemStatus?.docker.running ?? overview?.docker_ok) ? "success" : "destructive"}
            >
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
                <Badge className="shrink-0" variant="outline">
                  Préparation
                </Badge>
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
                    <span
                      className={cn(
                        "block truncate text-sm font-semibold uppercase",
                        absent ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
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
                        className={cn(
                          "inline-flex h-6 w-6 shrink-0 items-center justify-center",
                          // Un projet arrêté n'est pas en erreur : le gris laisse le rouge aux vraies pannes.
                          displayedRunning ? "text-emerald-500" : "text-muted-foreground/45",
                        )}
                        role="img"
                        aria-label={`${project.name} : ${displayedRunning ? "allumé" : "éteint"}`}
                      >
                        <Circle className="h-5 w-5 fill-current" aria-hidden="true" />
                      </span>
                    )}
                    <span
                      className={cn(
                        "w-7 text-xs font-semibold",
                        displayedRunning ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                      )}
                    >
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
          <Button className="w-full" variant="outline" onClick={openSettingsDialog}>
            <Settings className="h-4 w-4" />
            Paramètres
          </Button>
          <Button className="w-full" variant="secondary" onClick={() => setAboutOpen(true)}>
            <Info className="h-4 w-4" />À propos
          </Button>
        </div>
      </div>
    </aside>
  );
}
