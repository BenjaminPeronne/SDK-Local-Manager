"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Popover } from "@radix-ui/themes";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  RefreshCcw,
  Search,
} from "lucide-react";
import { recordRepositoryCheck, useRepositoryCheck } from "@/hooks/use-repository-updates";
import { api } from "@/lib/api";
import { handleListKeys } from "@/lib/list-navigation";
import {
  filterBranches,
  formatCommitDate,
  repositoryCommitUrl,
  repositoryBranchLocked,
  repositoryCompareUrl,
  type RepositoryBranches,
  repositoryUpdatable,
  repositoryUpdateAvailable,
  shortCommit,
} from "@/lib/module-repositories";
import type { Job, ModuleRepository, RepositoryDatabases } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

// Lignes affichées : au-delà, la recherche sert à trouver la branche voulue.
const VISIBLE_BRANCHES = 80;

/** `refreshing` : liste déjà lue, relue sur le serveur ; elle reste affichée en attendant. */
type BranchList =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; result: RepositoryBranches; refreshing: boolean };

/** Ce que le changement fait au code du projet, selon la nature du dépôt. */
function switchEffect(repository: ModuleRepository, moduleCount: number, branch: string) {
  if (repository.source === "import")
    return `Les ${moduleCount} module(s) copiés depuis ${repository.name} sont recopiés depuis la branche ${branch}. Les copies actuelles sont mises de côté.`;
  if (repository.source === "sdk")
    return `Le dossier ${repository.name}, téléchargé depuis la plateforme SDK, est remplacé par la branche ${branch}. L’ancien dossier est mis de côté.`;
  return `Les fichiers de ${repository.name} passent sur la branche ${branch}. Si des fichiers ont été modifiés sans être enregistrés dans Git, rien n’est changé.`;
}

/** Ce que la mise à jour fait au code du projet : la même branche, à son dernier commit. */
function updateEffect(repository: ModuleRepository, moduleCount: number, branch: string) {
  if (repositoryBranchLocked(repository))
    return repository.source === "sdk"
      ? `Les fichiers de ${repository.name} sont remplacés par ceux du dernier commit de la branche ${branch}, puis Odoo redémarre s’il tournait. L’ancien dossier est mis de côté.`
      : `Les fichiers de ${repository.name} reçoivent les derniers commits de la branche ${branch}, puis Odoo redémarre s’il tournait. Si des fichiers ont été modifiés sans être enregistrés dans Git, rien n’est changé.`;
  if (repository.source === "import")
    return `Les ${moduleCount} module(s) copiés depuis ${repository.name} sont recopiés depuis le dernier commit de la branche ${branch}. Les copies actuelles sont mises de côté.`;
  if (repository.source === "sdk")
    return `Le dossier ${repository.name}, téléchargé depuis la plateforme SDK, est remplacé par le dernier commit de la branche ${branch}. L’ancien dossier est mis de côté.`;
  return `Les fichiers de ${repository.name} reçoivent les derniers commits de la branche ${branch}. Si des fichiers ont été modifiés sans être enregistrés dans Git, rien n’est changé.`;
}

/**
 * Commit chargé et comparaison avec le dernier commit de sa branche sur le serveur : plusieurs
 * correctifs se suivent sur une même branche, le commit dit lequel le projet utilise.
 */
function CommitStatus({
  list,
  openUrl,
  repository,
  onUpdate,
}: {
  list: BranchList;
  openUrl: (url?: string) => Promise<void>;
  repository: ModuleRepository;
  onUpdate: () => void;
}) {
  const result = list.status === "ready" ? list.result : null;
  const commit = result ? result.commit : repository.commit;
  const checking = list.status === "idle" || list.status === "loading" || (list.status === "ready" && list.refreshing);
  const commitUrl = repositoryCommitUrl(repository, commit);
  const date = result ? formatCommitDate(result.commit_date) : "";
  const remote = result?.remote_commit ?? "";
  const compareUrl = repositoryCompareUrl(repository, commit, remote);
  return (
    <div className="grid gap-1.5 rounded-md border bg-muted/30 p-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-1.5">
        <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 text-muted-foreground">Commit chargé</span>
        <span className="select-all font-mono font-medium" title={commit || undefined}>
          {commit ? shortCommit(commit) : "inconnu"}
        </span>
        {commitUrl && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            title={`Voir le commit ${shortCommit(commit)} sur le site du dépôt`}
            aria-label={`Voir le commit ${shortCommit(commit)} sur le site du dépôt`}
            onClick={() => void openUrl(commitUrl)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {(result?.commit_subject || date) && (
        <p className="min-w-0 text-muted-foreground">
          {result?.commit_subject && (
            <span className="block truncate text-foreground" title={result.commit_subject}>
              {result.commit_subject}
            </span>
          )}
          {date}
        </p>
      )}
      {checking ? (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Comparaison avec le serveur…
        </p>
      ) : !result || !result.current ? null : result.commit_status === "same" ? (
        <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />À jour : c’est le dernier commit de la
          branche {result.current} sur le serveur.
        </p>
      ) : result.commit_status === "ahead" ? (
        <p className="text-muted-foreground">
          Ce dépôt contient des commits enregistrés ici qui ne sont pas encore sur le serveur : rien à récupérer.
        </p>
      ) : result.commit_status === "missing" ? (
        <p className="text-amber-700 dark:text-amber-300">
          {repositoryBranchLocked(repository)
            ? `La branche ${result.current} n’existe pas sur le serveur : rien à récupérer.`
            : `La branche ${result.current} n’existe plus sur le serveur : choisis-en une autre ci-dessous.`}
        </p>
      ) : repositoryUpdatable(result) ? (
        <div className="grid gap-2">
          <p className={result.commit_status === "behind" ? "text-amber-700 dark:text-amber-300" : undefined}>
            {result.commit_status === "behind"
              ? "Un commit plus récent est disponible sur le serveur : "
              : "Dernier commit de la branche sur le serveur : "}
            <span className="font-mono font-medium">{shortCommit(remote)}</span>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={onUpdate}>
              <ArrowDownToLine className="h-4 w-4" />
              Mettre à jour
            </Button>
            {compareUrl && (
              <Button type="button" size="sm" variant="ghost" onClick={() => void openUrl(compareUrl)}>
                <ExternalLink className="h-4 w-4" />
                Voir les changements
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
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
  previous,
  update,
  onUpdateChange,
}: {
  databases: DatabaseList;
  /** Code remplacé, pour l'avertissement : « l’ancienne branche » ou « l’ancien commit ». */
  previous: string;
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
              Sans mise à jour, leurs écrans et leurs données restent ceux de {previous}, ce qui peut causer des
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
  openUrl: (url?: string) => Promise<void>;
  projectName: string;
  repository: ModuleRepository;
};

/**
 * Branche et commit chargés d'un dépôt ; un clic les compare au serveur, propose de récupérer le
 * dernier commit de la branche ou de changer de branche. Quand le contrôle de la vue « Par dépôt » a
 * trouvé un commit plus récent, « Mise à jour disponible » le dit à côté et ouvre le même choix.
 */
export function RepositoryBranchPicker({
  createJob,
  moduleCount,
  openUrl,
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
  // Odoo et Enterprise : pas de liste de branches ni de bases à mettre à jour, seulement le dernier commit.
  const locked = repositoryBranchLocked(repository);
  const listId = useId();
  const check = useRepositoryCheck(projectName, repository);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    api<RepositoryBranches>(`/api/projects/${encodeURIComponent(projectName)}/repository/branches`, {
      method: "POST",
      body: JSON.stringify({ repository: repository.id }),
    })
      .then((result) => {
        recordRepositoryCheck(projectName, repository.id, {
          branch: result.current,
          commit: result.commit,
          remote_commit: result.remote_commit,
          commit_status: result.commit_status,
        });
        if (cancelled) return;
        setList({ status: "ready", result, refreshing: false });
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
    if (!chosen || locked) return;
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
  }, [chosen, locked, projectName, repository.id]);

  const matches = useMemo(
    () => (list.status === "ready" ? filterBranches(list.result.branches, search) : []),
    [list, search],
  );
  const visible = matches.slice(0, VISIBLE_BRANCHES);
  // Branche actuelle choisie : sa mise à jour, au dernier commit du serveur.
  const updating = Boolean(chosen) && chosen === current;
  const loadedCommit = list.status === "ready" ? list.result.commit : repository.commit;
  const remoteCommit = list.status === "ready" ? list.result.remote_commit : "";

  function reload() {
    setList((previous) => (previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" }));
    setRequest((value) => value + 1);
  }

  function select(name: string) {
    setChosen(name);
    setDatabases({ status: "loading" });
    setUpdateDatabases(true);
  }

  function choose(name: string) {
    if (name !== current) select(name);
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    // Relue à chaque ouverture : un correctif a pu arriver sur le serveur depuis la dernière lecture.
    if (next) reload();
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
        update_databases: updateDatabases && !nothingToUpdate && !locked,
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
          title={`Branche ${current || "inconnue"}${repository.commit ? ` · commit ${repository.commit}` : ""} — cliquer pour vérifier les mises à jour${locked ? "" : " ou changer de branche"}`}
          aria-label={`Branche ${current || "inconnue"}${repository.commit ? `, commit ${shortCommit(repository.commit)}` : ""} de ${repository.name} : vérifier les mises à jour${locked ? "" : " ou changer de branche"}`}
        >
          <GitBranch className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{current || "branche ?"}</span>
          {repository.commit && (
            <span className="shrink-0 font-normal text-muted-foreground">· {shortCommit(repository.commit)}</span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      {check && repositoryUpdateAvailable(check) && (
        <button
          type="button"
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
          title={`Un commit plus récent (${shortCommit(check.remote_commit)}) est sur le serveur pour la branche ${current} — cliquer pour le voir et mettre à jour`}
          aria-label={`Mise à jour disponible pour ${repository.name} : commit ${shortCommit(check.remote_commit)} sur le serveur`}
          onClick={() => changeOpen(true)}
        >
          <ArrowDownToLine className="h-3 w-3 shrink-0" aria-hidden="true" />
          Mise à jour disponible
        </button>
      )}
      {/* Jamais plus haute que la place libre au-dessus ou au-dessous du bouton : la liste des branches
          rétrécit d'abord, puis la fenêtre défile. Sans cette limite, elle sortait de la fenêtre. */}
      <Popover.Content
        size="1"
        align="start"
        collisionPadding={12}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(22rem,calc(100vw-2rem))] flex-col p-0"
      >
        {chosen ? (
          <div className="grid gap-3 p-3 text-sm">
            {updating && <p className="text-xs text-muted-foreground">Mise à jour de la branche {current}</p>}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-xs">
              <span className="truncate rounded border bg-muted/50 px-1.5 py-0.5 text-muted-foreground">
                {updating ? (loadedCommit ? shortCommit(loadedCommit) : "?") : current || "?"}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate rounded border border-primary/50 bg-primary/10 px-1.5 py-0.5 font-medium">
                {updating ? shortCommit(remoteCommit) || "dernier commit" : chosen}
              </span>
            </div>
            <p className="text-muted-foreground">
              {updating ? updateEffect(repository, moduleCount, chosen) : switchEffect(repository, moduleCount, chosen)}
            </p>
            {locked ? (
              <TrackedElsewhere list={list} />
            ) : (
              <AffectedDatabases
                databases={databases}
                previous={updating ? "l’ancien commit" : "l’ancienne branche"}
                update={updateDatabases}
                onUpdateChange={setUpdateDatabases}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setChosen("")}>
                Retour
              </Button>
              <Button type="button" size="sm" disabled={submitting} onClick={() => void confirm()}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : updating ? (
                  <ArrowDownToLine className="h-4 w-4" />
                ) : (
                  <GitBranch className="h-4 w-4" />
                )}
                {updating ? "Mettre à jour" : `Passer sur ${chosen}`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-2 p-2 [&>*]:shrink-0">
            <CommitStatus list={list} openUrl={openUrl} repository={repository} onUpdate={() => select(current)} />
            {locked ? (
              <p className="px-1 text-xs text-muted-foreground">
                La branche {current || "?"} correspond à la version d’Odoo du projet : elle ne change pas d’ici.
              </p>
            ) : (
              <BranchChooser
                active={active}
                choose={choose}
                current={current}
                list={list}
                listId={listId}
                matches={matches}
                reload={reload}
                repository={repository}
                search={search}
                setActive={setActive}
                setSearch={setSearch}
                visible={visible}
              />
            )}
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

/** Le dépôt de production rangé dans odoo/ suit aussi ces fichiers : il les verra modifiés. */
function TrackedElsewhere({ list }: { list: BranchList }) {
  const trackedBy = list.status === "ready" ? list.result.tracked_by : "";
  if (!trackedBy) return null;
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
      Ces fichiers sont aussi suivis par le dépôt {trackedBy} : après la mise à jour, il les verra modifiés. Ne les
      enregistre pas (commit) dans ce dépôt sans le vouloir.
    </p>
  );
}

/** Recherche et liste des branches du serveur, pour changer de branche. */
function BranchChooser({
  active,
  choose,
  current,
  list,
  listId,
  matches,
  reload,
  repository,
  search,
  setActive,
  setSearch,
  visible,
}: {
  active: number;
  choose: (name: string) => void;
  current: string;
  list: BranchList;
  listId: string;
  matches: RepositoryBranches["branches"];
  reload: () => void;
  repository: ModuleRepository;
  search: string;
  setActive: (index: number) => void;
  setSearch: (search: string) => void;
  visible: RepositoryBranches["branches"];
}) {
  return (
    <>
      <p className="px-1 pt-1 text-xs font-medium text-muted-foreground">Changer de branche</p>
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
          disabled={list.status === "loading" || (list.status === "ready" && list.refreshing)}
          title="Relire le serveur"
          aria-label="Relire le serveur"
          onClick={reload}
        >
          <RefreshCcw
            className={cn(
              "h-4 w-4",
              (list.status === "loading" || (list.status === "ready" && list.refreshing)) && "animate-spin",
            )}
          />
        </Button>
      </div>
      <div
        className={cn(
          "max-h-72 min-h-24 !shrink overflow-y-auto rounded-md border",
          // Place réservée pendant la lecture : la fenêtre choisit dès l'ouverture le côté où la
          // liste tiendra, au lieu de s'ouvrir là où tient le seul message d'attente.
          (list.status === "idle" || list.status === "loading") && "h-72",
        )}
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
    </>
  );
}
