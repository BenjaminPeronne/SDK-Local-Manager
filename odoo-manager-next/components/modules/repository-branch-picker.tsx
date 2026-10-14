"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Popover } from "@radix-ui/themes";
import { ArrowRight, Check, ChevronDown, GitBranch, Loader2, RefreshCcw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { handleListKeys } from "@/lib/list-navigation";
import { filterBranches, type RemoteBranch } from "@/lib/module-repositories";
import type { Job, ModuleRepository, RepositoryDatabases } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

// Lignes affichées : au-delà, la recherche sert à trouver la branche voulue.
const VISIBLE_BRANCHES = 80;

type BranchList =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; branches: RemoteBranch[] };

/** Ce que le changement fait au code du projet, selon la nature du dépôt. */
function switchEffect(repository: ModuleRepository, moduleCount: number, branch: string) {
  if (repository.source === "import")
    return `Les ${moduleCount} module(s) copiés depuis ${repository.name} sont recopiés depuis la branche ${branch}. Les copies actuelles sont mises de côté.`;
  if (repository.source === "sdk")
    return `Le dossier ${repository.name}, téléchargé depuis la plateforme SDK, est remplacé par la branche ${branch}. L’ancien dossier est mis de côté.`;
  return `Les fichiers de ${repository.name} passent sur la branche ${branch}. Si des fichiers ont été modifiés sans être enregistrés dans Git, rien n’est changé.`;
}

type DatabaseList =
  { status: "loading" } | { status: "error"; error: string } | ({ status: "ready" } & RepositoryDatabases);

/**
 * Le code d'un projet est le même pour toutes ses bases : le changement de branche les touche toutes.
 * Les bases qui utilisent des modules du dépôt doivent être mises à jour, sinon leurs écrans et leurs
 * données restent ceux de l'ancienne branche alors que le code a changé.
 */
function AffectedDatabases({
  databases,
  update,
  onUpdateChange,
}: {
  databases: DatabaseList;
  update: boolean;
  onUpdateChange: (update: boolean) => void;
}) {
  const used = databases.status === "ready" ? databases.databases : [];
  // Bases non lues ici : le serveur les cherchera lui-même au moment du changement.
  const unknown = databases.status === "error" || (databases.status === "ready" && !databases.running);
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-2.5 text-xs">
      <p className="text-muted-foreground">
        Toutes les bases du projet utiliseront ce code : elles partagent les mêmes modules.
      </p>
      {databases.status === "loading" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Recherche des bases qui utilisent ces modules…
        </p>
      ) : databases.status === "error" ? (
        <p className="text-destructive">
          Impossible de savoir pour l’instant quelles bases utilisent ces modules : {databases.error}
        </p>
      ) : unknown ? (
        <p className="text-muted-foreground">
          Le projet est arrêté. Pour mettre à jour les bases, il sera démarré au moment du changement.
        </p>
      ) : used.length ? (
        <ul className="grid gap-1" aria-label="Bases qui utilisent des modules de ce dépôt">
          {used.map((database) => (
            <li key={database.name} className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate font-mono">{database.name}</span>
              <span className="shrink-0 text-muted-foreground" title={database.modules.join(", ")}>
                {database.modules.length} module{database.modules.length > 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Aucune base n’utilise encore les modules de ce dépôt.</p>
      )}
      {(unknown || used.length > 0) && (
        <>
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
              className="mt-px"
              checked={update}
              onCheckedChange={(checked) => onUpdateChange(checked === true)}
            />
            <span>
              {unknown ? "Mettre à jour ensuite chaque base qui les utilise" : "Mettre à jour ces bases juste après"}
              <span className="text-muted-foreground"> (conseillé)</span>
            </span>
          </label>
          {!update && (
            <p className="text-muted-foreground">
              Sans mise à jour, leurs écrans et leurs données restent ceux de l’ancienne branche, ce qui peut causer des
              erreurs.
            </p>
          )}
        </>
      )}
    </div>
  );
}

type RepositoryBranchPickerProps = {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  /** Modules du dépôt dans le projet, recherche comprise. */
  moduleCount: number;
  projectName: string;
  repository: ModuleRepository;
};

/** Branche chargée d'un dépôt ; un clic liste les branches du serveur et propose d'en changer. */
export function RepositoryBranchPicker({
  createJob,
  moduleCount,
  projectName,
  repository,
}: RepositoryBranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<BranchList>({ status: "idle" });
  // Chaque demande de lecture (ouverture sans liste, « Relire ») relance la requête.
  const [request, setRequest] = useState(0);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState("");
  const [databases, setDatabases] = useState<DatabaseList>({ status: "loading" });
  const [updateDatabases, setUpdateDatabases] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const current = repository.branch;
  const listId = useId();

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    api<{ branches: RemoteBranch[] }>(`/api/projects/${encodeURIComponent(projectName)}/repository/branches`, {
      method: "POST",
      body: JSON.stringify({ repository: repository.id }),
    })
      .then((result) => {
        if (cancelled) return;
        setList({ status: "ready", branches: result.branches });
        setActive(0);
      })
      .catch((err) => {
        if (!cancelled)
          setList({ status: "error", error: err instanceof Error ? err.message : "Lecture des branches impossible." });
      });
    return () => {
      cancelled = true;
    };
  }, [request, projectName, repository.id]);

  // Bases concernées, relues à chaque branche choisie : une base a pu changer entre-temps.
  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    api<RepositoryDatabases>(`/api/projects/${encodeURIComponent(projectName)}/repository/databases`, {
      method: "POST",
      body: JSON.stringify({ repository: repository.id }),
    })
      .then((result) => {
        if (!cancelled) setDatabases({ status: "ready", ...result });
      })
      .catch((err) => {
        if (!cancelled)
          setDatabases({
            status: "error",
            error: err instanceof Error ? err.message : "Lecture des bases impossible.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [chosen, projectName, repository.id]);

  const matches = useMemo(() => (list.status === "ready" ? filterBranches(list.branches, search) : []), [list, search]);
  const visible = matches.slice(0, VISIBLE_BRANCHES);

  function reload() {
    setList({ status: "loading" });
    setRequest((value) => value + 1);
  }

  function choose(name: string) {
    if (name === current) return;
    setChosen(name);
    setDatabases({ status: "loading" });
    setUpdateDatabases(true);
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    // La liste lue reste valable le temps de choisir ; une erreur est retentée à la réouverture.
    if (next && list.status !== "ready") reload();
    if (!next) {
      setChosen("");
      setSearch("");
    }
  }

  async function confirm() {
    if (!chosen || submitting) return;
    setSubmitting(true);
    try {
      // Aucune base n'utilise le dépôt : le changement reste seul. Sinon, le serveur retrouve lui-même
      // les bases à mettre à jour, y compris quand la liste n'a pas pu être lue ici.
      const nothingToUpdate = databases.status === "ready" && databases.running && databases.databases.length === 0;
      const job = await createJob("switch_repository_branch", {
        project: projectName,
        repository: repository.id,
        branch: chosen,
        update_databases: updateDatabases && !nothingToUpdate,
      });
      if (job) changeOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger>
        <button
          type="button"
          className="inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-md border bg-background px-1.5 font-mono text-xs font-medium transition-colors hover:border-primary/50 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-primary/60 data-[state=open]:bg-hover"
          title={`Branche ${current || "inconnue"}${repository.commit ? ` · commit ${repository.commit}` : ""} — cliquer pour en changer`}
          aria-label={`Branche ${current || "inconnue"} de ${repository.name} : changer de branche`}
        >
          <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{current || "branche ?"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Content size="1" align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        {chosen ? (
          <div className="grid gap-3 p-3 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-xs">
              <span className="truncate rounded border bg-muted/50 px-1.5 py-0.5 text-muted-foreground">
                {current || "?"}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate rounded border border-primary/50 bg-primary/10 px-1.5 py-0.5 font-medium">
                {chosen}
              </span>
            </div>
            <p className="text-muted-foreground">{switchEffect(repository, moduleCount, chosen)}</p>
            <AffectedDatabases databases={databases} update={updateDatabases} onUpdateChange={setUpdateDatabases} />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setChosen("")}>
                Retour
              </Button>
              <Button type="button" size="sm" disabled={submitting} onClick={() => void confirm()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
                Passer sur {chosen}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 p-2">
            <div className="flex items-center gap-1">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(event) =>
                    handleListKeys(event, visible.length, active, setActive, (index) => {
                      const branch = visible[index];
                      if (branch) choose(branch.name);
                    })
                  }
                  placeholder="Filtrer les branches"
                  aria-label={`Filtrer les branches de ${repository.name}`}
                  role="combobox"
                  aria-expanded={visible.length > 0}
                  aria-controls={listId}
                  aria-activedescendant={visible.length ? `${listId}-${active}` : undefined}
                  autoFocus
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                disabled={list.status === "loading"}
                title="Relire les branches du serveur"
                aria-label="Relire les branches du serveur"
                onClick={reload}
              >
                <RefreshCcw className={cn("h-4 w-4", list.status === "loading" && "animate-spin")} />
              </Button>
            </div>
            <div
              className="max-h-72 overflow-y-auto rounded-md border"
              role="listbox"
              id={listId}
              aria-label={`Branches de ${repository.name}`}
            >
              {list.status === "loading" || list.status === "idle" ? (
                <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Lecture des branches sur le serveur…
                </p>
              ) : list.status === "error" ? (
                <p className="p-3 text-sm text-destructive">{list.error}</p>
              ) : visible.length ? (
                <div className="divide-y">
                  {visible.map((branch, index) => {
                    const isCurrent = branch.name === current;
                    return (
                      <button
                        key={branch.name}
                        id={`${listId}-${index}`}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={isCurrent}
                        aria-disabled={isCurrent}
                        className={cn(
                          "flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                          isCurrent ? "cursor-default bg-selected font-medium" : "hover:bg-hover",
                          index === active && !isCurrent && "bg-hover ring-1 ring-inset ring-primary/40",
                        )}
                        onMouseMove={() => setActive(index)}
                        onClick={() => choose(branch.name)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {isCurrent ? (
                            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                          ) : (
                            <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span className="truncate font-mono text-[13px]">{branch.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {isCurrent ? "Actuelle" : branch.default ? "Par défaut" : ""}
                        </span>
                      </button>
                    );
                  })}
                  {matches.length > visible.length && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      {matches.length - visible.length} autre(s) : précise la recherche.
                    </p>
                  )}
                </div>
              ) : (
                <p className="p-3 text-sm text-muted-foreground">
                  {search.trim() ? "Aucune branche ne correspond à cette recherche." : "Aucune branche sur le serveur."}
                </p>
              )}
            </div>
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
