"use client";

import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import { Circle, FolderPlus, Info, Loader2, Search, Settings, Star } from "lucide-react";
import type { StaticImageData } from "next/image";
import { statusVariant, workspaceLabel } from "@/lib/format";
import { isJobActive, isJobUnfinished, MIGRATION_JOB_PREFIX } from "@/lib/jobs";
import { odooServerStopped } from "@/lib/projects";
import type { Season } from "@/lib/seasonal";
import type { AppUpdate, ExternalLogView, Job, ManagerSettings, Overview, Project, SystemStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChristmasHat } from "@/components/seasonal/christmas";
import { BunnyEars } from "@/components/seasonal/easter";
import { WitchHat } from "@/components/seasonal/halloween";
import { ThemeToggle } from "@/components/theme-toggle";
import { UpdateBanner } from "@/components/shell/update-banner";
import { GeneralActivity } from "@/components/jobs/job-activity";
import type { UpdateInstaller } from "@/hooks/use-update-installer";

type AppSidebarProps = {
  availableUpdate: AppUpdate | null;
  dismissUpdate: () => void;
  hasRunningJobs: boolean;
  updateInstaller: UpdateInstaller;
  jobs: Job[];
  openCreateProjectDialog: () => void;
  openSettingsDialog: () => void;
  openUrl: (url?: string) => Promise<void>;
  overview: Overview | null;
  pendingProjectArrivals: Job[];
  season: Season | null;
  selectedAppIcon: StaticImageData;
  selectedProject: Project | undefined;
  selectedProjectName: string;
  selectJob: (jobId: number) => void;
  setAboutOpen: Dispatch<SetStateAction<boolean>>;
  setActiveTab: Dispatch<SetStateAction<string>>;
  openProject: (project: Project) => void;
  setExternalLogView: Dispatch<SetStateAction<ExternalLogView | null>>;
  setSelectedDb: Dispatch<SetStateAction<string>>;
  setSelectedProjectName: Dispatch<SetStateAction<string>>;
  settings: ManagerSettings | null;
  systemStatus: SystemStatus | null;
};

const NO_FAVORITES: string[] = [];
type SidebarPreferences = { favorites: Record<string, string[]> };
const SIDEBAR_STORAGE_KEY = "sdk-local-manager.sidebar";
function storedSidebarPreferences(): SidebarPreferences {
  try {
    const value = JSON.parse(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) || "null");
    return { favorites: value?.favorites && typeof value.favorites === "object" ? value.favorites : {} };
  } catch {
    return { favorites: {} };
  }
}

export function AppSidebar({
  availableUpdate,
  dismissUpdate,
  hasRunningJobs,
  jobs,
  openCreateProjectDialog,
  openSettingsDialog,
  openUrl,
  overview,
  pendingProjectArrivals,
  season,
  selectedAppIcon,
  selectedProject,
  selectedProjectName,
  selectJob,
  setAboutOpen,
  setActiveTab,
  openProject,
  setExternalLogView,
  setSelectedDb,
  setSelectedProjectName,
  settings,
  systemStatus,
  updateInstaller,
}: AppSidebarProps) {
  const [projectsFilter, setProjectsFilter] = useState("");
  const [preferences, setPreferences] = useState(storedSidebarPreferences);
  const workspace = overview?.workspace || "";
  const favorites = Array.isArray(preferences.favorites[workspace]) ? preferences.favorites[workspace] : NO_FAVORITES;
  function savePreferences(next: SidebarPreferences) {
    setPreferences(next);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* Préférence conservée pour cette session. */
    }
  }
  function toggleFavorite(name: string) {
    savePreferences({
      ...preferences,
      favorites: {
        ...preferences.favorites,
        [workspace]: favorites.includes(name) ? favorites.filter((item) => item !== name) : [...favorites, name],
      },
    });
  }
  const projectLifecycleJobs = useMemo(() => {
    const runningJobs = new Map<string, Job>();
    for (const job of jobs) {
      if (isJobActive(job)) runningJobs.set(job.title, job);
    }
    return runningJobs;
  }, [jobs]);
  // Toute action en cours d'un projet le signale dans la liste, qu'il soit ouvert ou non.
  const projectBusyJobs = useMemo(() => {
    const busy = new Map<string, Job>();
    for (const job of jobs) {
      if (job.project && isJobActive(job) && !busy.has(job.project)) busy.set(job.project, job);
    }
    return busy;
  }, [jobs]);
  const generalJobs = useMemo(() => jobs.filter((job) => !job.project && isJobUnfinished(job)), [jobs]);
  const filteredProjects = useMemo(() => {
    const query = projectsFilter.trim().toLowerCase();
    return (overview?.projects || [])
      .filter((project) => !query || project.name.toLowerCase().includes(query))
      .sort((left, right) => {
        // Favoris d’abord, puis projets allumés dans chaque groupe. À priorité égale,
        // le tri stable conserve l’ordre du serveur et évite les déplacements inutiles.
        const favoriteOrder = Number(favorites.includes(right.name)) - Number(favorites.includes(left.name));
        if (favoriteOrder) return favoriteOrder;
        const isOn = (project: Project) =>
          (project.odoo_status === "running" && !odooServerStopped(project)) ||
          projectLifecycleJobs.has(`Démarrer ${project.name}`);
        return Number(isOn(right)) - Number(isOn(left));
      });
  }, [overview, projectsFilter, favorites, projectLifecycleJobs]);

  return (
    <aside className="min-w-0 border-b bg-card lg:sticky lg:top-0 lg:h-screen lg:w-80 lg:flex-none lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col">
        <div className="sdk-brand border-b p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="relative shrink-0">
                <img
                  src={selectedAppIcon.src}
                  alt=""
                  aria-hidden="true"
                  className={cn(
                    "sdk-logo h-10 w-10 object-contain",
                    settings?.interface_icon === "local" ? "rounded-full" : "rounded-[9px]",
                  )}
                />
                {season === "christmas" && <ChristmasHat />}
                {season === "easter" && <BunnyEars />}
                {season === "halloween" && <WitchHat />}
              </span>
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
              {overview?.workspace ? workspaceLabel(overview.workspace) : "Workspace local"}
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
        <div className="min-h-0 max-h-[260px] flex-1 space-y-1 overflow-auto px-2 py-2 sm:max-h-[340px] lg:max-h-none">
          {pendingProjectArrivals.map((job) => (
            <div
              key={`creating-${job.id}`}
              className={cn(
                "rounded-lg border border-transparent bg-primary/[0.06] transition-colors dark:bg-primary/[0.1]",
                selectedProjectName === job.project && "border-primary/40 bg-selected",
              )}
            >
              <button
                type="button"
                className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-current={selectedProjectName === job.project ? "page" : undefined}
                onClick={() => {
                  setSelectedProjectName(job.project || "");
                  setSelectedDb("");
                  setExternalLogView(null);
                  selectJob(job.id);
                  setActiveTab("logs");
                }}
              >
                <span className="min-w-0 flex-1 py-1.5">
                  <span className="block truncate text-sm font-semibold uppercase">{job.project}</span>
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
          {!filteredProjects.length && !pendingProjectArrivals.length && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Aucun projet ne correspond à la recherche.
            </p>
          )}
          {filteredProjects.map((project) => {
            const running = project.odoo_status === "running";
            const serverStopped = odooServerStopped(project);
            const absent = project.odoo_status === "absent" || project.odoo_status === "docker off";
            const lifecycleJob =
              projectLifecycleJobs.get(`Démarrer ${project.name}`) ||
              projectLifecycleJobs.get(`Arrêter ${project.name}`);
            const switchingOn = lifecycleJob?.title.startsWith("Démarrer ") ?? false;
            const displayedRunning = (running && !serverStopped) || switchingOn;
            const displayedServerStopped = serverStopped && !switchingOn;
            const busyJob = lifecycleJob || projectBusyJobs.get(project.name);
            const selected = selectedProject?.name === project.name;

            return (
              <div
                key={project.name}
                className={cn(
                  "group rounded-lg border border-transparent transition-colors duration-150 hover:bg-hover",
                  absent && "bg-muted/35 text-muted-foreground",
                  selected && "border-primary/40 bg-selected hover:bg-selected",
                )}
              >
                <div className="flex min-h-12 items-center gap-2 px-3">
                  <button
                    type="button"
                    aria-current={selected ? "page" : undefined}
                    className="-mx-1 min-w-0 flex-1 rounded-md px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => {
                      setExternalLogView(null);
                      openProject(project);
                    }}
                  >
                    <span
                      className={cn(
                        "block truncate text-sm font-semibold uppercase",
                        absent && !selected ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {project.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {project.odoo_version ? `Odoo ${project.odoo_version}` : "Version inconnue"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "shrink-0 rounded p-1.5 text-muted-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      // Étoile vide seulement au survol ou au clavier : les favoris restent seuls visibles.
                      !favorites.includes(project.name) &&
                        "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
                    )}
                    aria-label={`${favorites.includes(project.name) ? "Retirer" : "Ajouter"} ${project.name} ${favorites.includes(project.name) ? "des" : "aux"} favoris`}
                    aria-pressed={favorites.includes(project.name)}
                    onClick={() => toggleFavorite(project.name)}
                  >
                    <Star
                      className={cn("h-3.5 w-3.5", favorites.includes(project.name) && "fill-primary text-primary")}
                    />
                  </button>
                  <div className="flex w-[74px] shrink-0 items-center justify-end gap-2">
                    {busyJob ? (
                      <span title={busyJob.title} className="inline-flex h-6 w-6 items-center justify-center">
                        <Loader2
                          className="h-4 w-4 animate-spin text-primary"
                          aria-label={`En cours : ${busyJob.title}`}
                        />
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex h-6 w-6 shrink-0 items-center justify-center",
                          // Un projet arrêté n'est pas en erreur : le gris laisse le rouge aux vraies pannes.
                          displayedRunning
                            ? "text-emerald-500"
                            : displayedServerStopped
                              ? "text-amber-500"
                              : "text-muted-foreground/70 dark:text-muted-foreground",
                        )}
                        role="img"
                        aria-label={`${project.name} : ${displayedRunning ? "allumé" : displayedServerStopped ? "conteneur démarré, Odoo arrêté" : "éteint"}`}
                        title={
                          displayedServerStopped
                            ? "Le conteneur tourne, mais pas le serveur Odoo : Démarrer ou Ouvrir Odoo le relance."
                            : undefined
                        }
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
                  <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 text-xs">
                    <Badge variant={statusVariant(project.odoo_status)}>Odoo {project.odoo_status}</Badge>
                    {serverStopped && <Badge variant="warning">serveur Odoo arrêté</Badge>}
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
        <div className="grid grid-cols-2 gap-2 border-t p-3">
          <GeneralActivity jobs={generalJobs} className="col-span-2" />
          {availableUpdate && (
            <UpdateBanner
              update={availableUpdate}
              installer={updateInstaller}
              hasRunningJobs={hasRunningJobs}
              onDismiss={dismissUpdate}
              openUrl={openUrl}
            />
          )}
          <Button className="col-span-2 w-full" onClick={openCreateProjectDialog}>
            <FolderPlus className="h-4 w-4" />
            Nouveau projet
          </Button>
          <Button className="w-full" size="sm" variant="ghost" onClick={openSettingsDialog}>
            <Settings className="h-4 w-4" />
            Paramètres
          </Button>
          <Button className="w-full" size="sm" variant="ghost" onClick={() => setAboutOpen(true)}>
            <Info className="h-4 w-4" />À propos
          </Button>
        </div>
      </div>
    </aside>
  );
}
