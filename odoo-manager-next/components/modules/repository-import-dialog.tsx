"use client";

import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { ChevronDown, CloudDownload, KeyRound, Loader2, RefreshCcw, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import type { GitLabStatus } from "@/lib/desktop";
import { normalizeSearchText } from "@/lib/format";
import type { Job, Project, RepositoryInspection, RepositoryModule } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  defaultRepositorySource,
  GitLabRepositoryPicker,
  type RepositorySource,
  RepositorySourceToggle,
} from "@/components/gitlab-repository-picker";
import { RepositoryModuleStatus, RepositoryModuleVersion } from "@/components/modules/module-badges";

// Au-delà, le rendu des lignes ralentit la fenêtre (dépôts complets de 1 500 modules) : on filtre.
const REPOSITORY_PICKER_MAX_ROWS = 200;

const REPOSITORY_ACTION_ORDER = { update: 0, add: 1, blocked: 2 } as const;

type RepositoryImportDialogProps = {
  canUseDb: boolean;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  gitlabStatus: GitLabStatus | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  openAccountSettings: () => void;
  openSshAssistant: (regenerate?: boolean) => Promise<void>;
  repositoryBranch: string;
  repositoryInspectionKey: string;
  repositoryUrl: string;
  repositoryUrlError: string;
  selectedDb: string;
  selectedProject: Project | undefined;
  selectedProjectReady: boolean;
  setActiveTab: Dispatch<SetStateAction<string>>;
  setGitlabStatus: Dispatch<SetStateAction<GitLabStatus | null>>;
  setRepositoryBranch: Dispatch<SetStateAction<string>>;
  setRepositoryUrl: Dispatch<SetStateAction<string>>;
};

export function RepositoryImportDialog({ canUseDb, createJob, gitlabStatus, onOpenChange, open, openAccountSettings, openSshAssistant, repositoryBranch, repositoryInspectionKey, repositoryUrl, repositoryUrlError, selectedDb, selectedProject, selectedProjectReady, setActiveTab, setGitlabStatus, setRepositoryBranch, setRepositoryUrl }: RepositoryImportDialogProps) {
  const [repositorySubmitting, setRepositorySubmitting] = useState(false);
  const [repositoryInspection, setRepositoryInspection] = useState<RepositoryInspection>({ status: "idle" });
  const [repositorySelection, setRepositorySelection] = useState<Set<string>>(new Set());
  const [repositoryFilter, setRepositoryFilter] = useState("");
  const [repositoryInspectionAttempt, setRepositoryInspectionAttempt] = useState(0);
  const [repositorySource, setRepositorySource] = useState<RepositorySource>("ssh");
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
      onOpenChange(false);
      setActiveTab("logs");
    } finally {
      setRepositorySubmitting(false);
    }
  }
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
    if (!open) return;
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
  }, [open]);
  useEffect(() => {
    if (!open) {
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
  }, [repositoryInspectionKey, open, repositoryInspectionAttempt]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                  onOpenChange(false);
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
            <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
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
  );
}
