"use client";

import { CheckCircle2, GitBranch, KeyRound, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { desktopErrorMessage, type GitLabProject, type GitLabRefs, type GitLabStatus } from "@/lib/desktop";
import { handleListKeys } from "@/lib/list-navigation";
import { cn } from "@/lib/utils";

export type RepositorySource = "ssh" | "gitlab";

/**
 * Choix de la source d'un dépôt : lien SSH saisi à la main, ou recherche dans GitLab.
 *
 * Affiché dès que GitLab est utilisable sur ce poste, connecté ou non : un compte à reconnecter
 * doit se voir, pas faire disparaître l'option.
 */
export function RepositorySourceToggle({
  value,
  onChange,
  status,
}: {
  value: RepositorySource;
  onChange: (value: RepositorySource) => void;
  status: GitLabStatus | null;
}) {
  if (!status?.available && !status?.unreadable) return null;
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-md border bg-muted p-1"
      role="radiogroup"
      aria-label="Source du dépôt"
    >
      {(
        [
          ["gitlab", "Rechercher dans GitLab"],
          ["ssh", "Lien SSH"],
        ] as const
      ).map(([option, label]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={cn(
            "rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === option
              ? "bg-card text-foreground shadow-sm ring-1 ring-primary/40"
              : "text-muted-foreground hover:bg-hover hover:text-foreground",
          )}
          onClick={() => onChange(option)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Source proposée à l'ouverture : GitLab quand le compte est connecté, le lien SSH sinon. */
export function defaultRepositorySource(status: GitLabStatus | null): RepositorySource {
  return status?.connected ? "gitlab" : "ssh";
}

/**
 * Recherche d'un dépôt GitLab, puis de sa branche, parmi ce que le compte voit réellement.
 *
 * Partagée par l'import de modules et la création de projet. Le clavier suffit : on tape pour
 * filtrer, les flèches parcourent, Entrée choisit, et le focus passe du dépôt à sa branche.
 */
export function GitLabRepositoryPicker({
  status,
  url,
  branch,
  preferredBranches = [],
  preferDefaultBranch = false,
  onChange,
  onManageAccount,
}: {
  status: GitLabStatus | null;
  /** Dépôt déjà retenu par la fenêtre : toujours affiché, jamais gardé en mémoire à l'insu de l'utilisateur. */
  url: string;
  branch: string;
  /** Branches à proposer d'office, dans l'ordre, si le dépôt en a une : la version Odoo, par exemple. */
  preferredBranches?: string[];
  /** Sans branche préférée trouvée, prendre la branche par défaut du dépôt. */
  preferDefaultBranch?: boolean;
  onChange: (value: { url: string; branch: string }) => void;
  onManageAccount?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<GitLabProject[] | null>(null);
  const [project, setProject] = useState<GitLabProject | null>(null);
  const [refSearch, setRefSearch] = useState("");
  const [refs, setRefs] = useState<GitLabRefs | null>(null);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [refActiveIndex, setRefActiveIndex] = useState(0);
  const connected = Boolean(status?.connected);

  const refOptions = useMemo(
    () =>
      refs
        ? [
            ...[...refs.branches]
              .sort((left, right) => Number(right.default) - Number(left.default))
              .map((ref) => ({ name: ref.name, kind: ref.default ? "Branche par défaut" : "Branche" })),
            ...refs.tags.map((tag) => ({ name: tag, kind: "Tag" })),
          ]
        : [],
    [refs],
  );

  useEffect(() => {
    const bridge = window.sdkDesktop;
    if (!connected || project || !bridge) return;
    let cancelled = false;
    setProjects(null);
    const timer = window.setTimeout(() => {
      bridge
        .gitlabProjects(search)
        .then((found) => {
          if (cancelled) return;
          setProjects(found);
          setError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setProjects([]);
          setError(desktopErrorMessage(err, "Recherche GitLab impossible."));
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connected, project, search]);

  useEffect(() => {
    const bridge = window.sdkDesktop;
    if (!connected || !project || !bridge) return;
    let cancelled = false;
    setRefs(null);
    const timer = window.setTimeout(() => {
      bridge
        .gitlabRefs(project.id, refSearch)
        .then((found) => {
          if (cancelled) return;
          setRefs(found);
          setError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setRefs({ branches: [], tags: [] });
          setError(desktopErrorMessage(err, "Lecture des branches impossible."));
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connected, project, refSearch]);

  // Branche proposée d'office, sans jamais écraser un choix déjà fait.
  useEffect(() => {
    if (!refs || !project || branch) return;
    const names = new Set(refs.branches.map((ref) => ref.name));
    const preferred = preferredBranches.find((name) => names.has(name));
    const fallback = preferDefaultBranch ? refs.branches.find((ref) => ref.default)?.name || project.defaultBranch : "";
    const proposed = preferred || fallback;
    if (proposed) onChange({ url: project.sshUrl, branch: proposed });
    // Seule une nouvelle liste de branches déclenche la proposition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs]);

  // Nouvelle liste : la première ligne est active ; pour les branches, celle déjà choisie.
  useEffect(() => setActiveIndex(0), [projects]);
  useEffect(() => {
    const selected = refOptions.findIndex((ref) => ref.name === branch);
    setRefActiveIndex(selected >= 0 ? selected : 0);
  }, [refOptions, branch]);
  // La ligne active reste visible quand on la déplace au clavier dans une liste qui défile.
  useEffect(() => {
    document.getElementById(`gitlab-project-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  useEffect(() => {
    document.getElementById(`gitlab-ref-${refActiveIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [refActiveIndex]);

  function chooseProject(chosen: GitLabProject) {
    setProject(chosen);
    setRefSearch("");
    onChange({ url: chosen.sshUrl, branch: "" });
  }

  function changeProject() {
    setProject(null);
    setRefs(null);
    onChange({ url: "", branch: "" });
  }

  const retained =
    !project && url ? (
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-muted/35 p-3 text-sm">
        <span className="min-w-0">
          <span className="block truncate font-medium">Dépôt retenu</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">{url}</span>
          <span className="mt-1 flex items-center gap-1.5 text-xs">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {branch ? (
              <span className="font-mono font-medium">{branch}</span>
            ) : (
              <span className="text-muted-foreground">Aucune branche choisie</span>
            )}
          </span>
        </span>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={changeProject}>
          Changer
        </Button>
      </div>
    ) : null;

  if (!connected) {
    return (
      <div className="space-y-2">
        {retained}
        <div className="flex flex-col gap-3 rounded-md border border-dashed p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-muted-foreground">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
            {status?.unreadable
              ? status.reason
              : "Connecte ton compte GitLab pour retrouver tes dépôts et leurs branches sans copier d’URL."}
          </p>
          {onManageAccount && (
            <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onManageAccount}>
              {status?.unreadable ? "Reconnecter GitLab" : "Connecter GitLab"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (retained) return retained;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!project ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) =>
                handleListKeys(event, projects?.length ?? 0, activeIndex, setActiveIndex, (index) => {
                  const found = projects?.[index];
                  if (found) chooseProject(found);
                })
              }
              placeholder="Nom du dépôt, par exemple protex"
              aria-label="Rechercher un dépôt GitLab"
              role="combobox"
              aria-expanded={Boolean(projects?.length)}
              aria-controls="gitlab-projects"
              aria-activedescendant={projects?.length ? `gitlab-project-${activeIndex}` : undefined}
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {projects === null ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Recherche dans GitLab…
              </p>
            ) : projects.length ? (
              <div className="divide-y" role="listbox" id="gitlab-projects" aria-label="Dépôts GitLab">
                {projects.map((found, index) => (
                  <button
                    key={found.id}
                    id={`gitlab-project-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    className={cn(
                      "flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-hover",
                      index === activeIndex && "bg-hover ring-1 ring-inset ring-primary/40",
                    )}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => chooseProject(found)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{found.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{found.path}</span>
                    </span>
                    {found.defaultBranch && (
                      <Badge variant="outline" className="shrink-0">
                        {found.defaultBranch}
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                Aucun dépôt accessible ne correspond à cette recherche.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-muted/35 p-3 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{project.name}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">{project.sshUrl}</span>
              <span className="mt-1 flex items-center gap-1.5 text-xs">
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {branch ? (
                  <span className="font-mono font-medium">{branch}</span>
                ) : (
                  <span className="text-muted-foreground">Choisis une branche ou un tag ci-dessous</span>
                )}
              </span>
            </span>
            <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={changeProject}>
              Changer
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={refSearch}
              onChange={(event) => setRefSearch(event.target.value)}
              onKeyDown={(event) =>
                handleListKeys(event, refOptions.length, refActiveIndex, setRefActiveIndex, (index) => {
                  const ref = refOptions[index];
                  if (ref) onChange({ url: project.sshUrl, branch: ref.name });
                })
              }
              placeholder="Filtrer les branches et tags"
              aria-label="Filtrer les branches et tags"
              role="combobox"
              aria-expanded={refOptions.length > 0}
              aria-controls="gitlab-refs"
              aria-activedescendant={refOptions.length ? `gitlab-ref-${refActiveIndex}` : undefined}
              autoFocus
            />
          </div>
          <div
            className="max-h-56 overflow-y-auto rounded-md border"
            role="listbox"
            id="gitlab-refs"
            aria-label="Branches et tags"
          >
            {refs === null ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lecture des branches…
              </p>
            ) : refOptions.length ? (
              <div className="divide-y">
                {refOptions.map((ref, index) => (
                  <button
                    key={`${ref.kind}:${ref.name}`}
                    id={`gitlab-ref-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={branch === ref.name}
                    className={cn(
                      "flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-hover",
                      index === refActiveIndex && "bg-hover ring-1 ring-inset ring-primary/40",
                      branch === ref.name && "bg-selected font-medium",
                    )}
                    onMouseMove={() => setRefActiveIndex(index)}
                    onClick={() => onChange({ url: project.sshUrl, branch: ref.name })}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {branch === ref.name ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate font-mono text-[13px]">{ref.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{ref.kind}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">Aucune branche ni aucun tag ne correspond.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
