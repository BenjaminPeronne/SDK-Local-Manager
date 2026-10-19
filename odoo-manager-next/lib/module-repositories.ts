import type { ModuleInfo, ModuleRepository, RepositoryModule } from "./types";

/** Groupe de la vue par dépôt ; `repository` est absent pour les modules sans dépôt connu. */
export type ModuleRepositoryGroup = {
  id: string;
  repository: ModuleRepository | null;
  modules: ModuleInfo[];
  installed: number;
};

export const NO_REPOSITORY_GROUP = "";

/** Module installé ou en cours de changement dans la base : compte comme utilisé. */
function installedState(state: string) {
  return state === "installed" || state === "to upgrade" || state === "to remove";
}

/**
 * Modules regroupés par dépôt, dans l'ordre des dépôts reçus (ceux du projet, puis Odoo et
 * Enterprise) ; les modules sans dépôt connu ferment la marche des dépôts du projet. L'ordre des
 * modules (pertinence de la recherche) est conservé dans chaque groupe.
 */
export function groupModulesByRepository(
  modules: ModuleInfo[],
  repositories: ModuleRepository[],
): ModuleRepositoryGroup[] {
  const known = new Map(repositories.map((repository) => [repository.id, repository]));
  const buckets = new Map<string, ModuleInfo[]>();
  for (const item of modules) {
    const id = item.repository && known.has(item.repository) ? item.repository : NO_REPOSITORY_GROUP;
    const bucket = buckets.get(id);
    if (bucket) bucket.push(item);
    else buckets.set(id, [item]);
  }
  const group = (id: string, repository: ModuleRepository | null): ModuleRepositoryGroup | null => {
    const members = buckets.get(id);
    if (!members?.length) return null;
    return {
      id,
      repository,
      modules: members,
      installed: members.filter((module) => installedState(module.state)).length,
    };
  };
  const projectGroups = repositories.filter((repository) => !repository.standard).map((r) => group(r.id, r));
  const standardGroups = repositories.filter((repository) => repository.standard).map((r) => group(r.id, r));
  return [...projectGroups, group(NO_REPOSITORY_GROUP, null), ...standardGroups].filter(
    (item): item is ModuleRepositoryGroup => item !== null,
  );
}

/** Commit abrégé, comme Git l'affiche : les premiers caractères suffisent à le reconnaître. */
export function shortCommit(commit: string) {
  return commit.slice(0, 7);
}

/** Ce que le dépôt a de chargé : branche, sinon étiquette, sinon commit. */
export function repositoryRevision(repository: ModuleRepository) {
  if (repository.branch) return { kind: "branch" as const, label: repository.branch };
  if (repository.tag) return { kind: "tag" as const, label: repository.tag };
  if (repository.commit) return { kind: "commit" as const, label: shortCommit(repository.commit) };
  return null;
}

/** Page web du dépôt, déduite de son adresse : gitlab.sudokeys.com/OCA/pos → https://gitlab.sudokeys.com/OCA/pos. */
export function repositoryWebUrl(repository: Pick<ModuleRepository, "remote_label">) {
  return repository.remote_label.includes("/") ? `https://${repository.remote_label}` : "";
}

/** Préfixe des pages d'un commit : `/-/` sur GitLab, rien sur GitHub. */
function webPagePrefix(base: string) {
  return new URL(base).hostname === "github.com" ? "" : "/-";
}

/** Page d'un commit sur le site du dépôt : son titre, sa date et ses changements. */
export function repositoryCommitUrl(repository: Pick<ModuleRepository, "remote_label">, commit: string) {
  const base = repositoryWebUrl(repository);
  return base && commit ? `${base}${webPagePrefix(base)}/commit/${commit}` : "";
}

/** Commits apparus entre deux commits, sur le site du dépôt. */
export function repositoryCompareUrl(repository: Pick<ModuleRepository, "remote_label">, from: string, to: string) {
  const base = repositoryWebUrl(repository);
  return base && from && to ? `${base}${webPagePrefix(base)}/compare/${from}...${to}` : "";
}

/**
 * Dépôt que remplacent les copies importées du groupe, quand elles en remplacent toutes un seul :
 * l'en-tête du dépôt l'affiche une fois au lieu de le répéter sur chaque ligne.
 */
export function sharedReplacedRepository(modules: ModuleInfo[]) {
  const labels = new Set<string>();
  let count = 0;
  for (const item of modules) {
    if (!item.replaced_repository) continue;
    labels.add(item.replaced_repository);
    count += 1;
  }
  return labels.size === 1 ? { label: [...labels][0], count } : null;
}

/** Clone ou archive rangé dans le projet, ou copie importée : sa branche peut changer depuis la liste. */
export function repositoryBranchSwitchable(repository: ModuleRepository) {
  if (repository.standard) return false;
  if (repository.source === "import") return true;
  return (repository.source === "git" || repository.source === "sdk") && Boolean(repository.path);
}

export type RemoteBranch = { name: string; default: boolean; commit: string };

/**
 * Commit chargé comparé au dernier commit de sa branche sur le serveur.
 * same : le même ; behind : le serveur en a un plus récent ; ahead : le dépôt a des commits pas encore
 * envoyés ; missing : la branche n'existe plus sur le serveur ; unknown : commit chargé inconnu.
 */
export type CommitStatus = "same" | "behind" | "ahead" | "missing" | "unknown";

/** Branches du dépôt sur le serveur et état du commit chargé (voir repository_branches côté serveur). */
export type RepositoryBranches = {
  current: string;
  kind: "git" | "sdk" | "import";
  branches: RemoteBranch[];
  commit: string;
  remote_commit: string;
  commit_status: CommitStatus;
  /** Date ISO et titre du commit chargé, lus seulement dans un clone Git. */
  commit_date: string;
  commit_subject: string;
};

/** Date d'un commit, à l'heure de l'ordinateur : « 12 octobre 2026 à 14:05 » ; vide si illisible. */
export function formatCommitDate(iso: string) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${day} à ${time}`;
}

/** La branche chargée peut recevoir un commit plus récent du serveur. */
export function repositoryUpdatable(result: Pick<RepositoryBranches, "current" | "commit_status" | "remote_commit">) {
  if (!result.current || !result.remote_commit) return false;
  return result.commit_status === "behind" || result.commit_status === "unknown";
}

/** Branches dont le nom contient la recherche, sans tenir compte des majuscules ; l'ordre reçu est gardé. */
export function filterBranches(branches: RemoteBranch[], search: string) {
  const query = search.trim().toLocaleLowerCase();
  return query ? branches.filter((branch) => branch.name.toLocaleLowerCase().includes(query)) : branches;
}

/**
 * Modules manquants de la base retrouvés dans un dépôt, par nom exact (le nom d'un module Odoo est
 * celui de son dossier) : importables, présents mais non importables, ou absents du dépôt.
 */
export function matchWantedModules(modules: RepositoryModule[], wanted: string[]) {
  const actions = new Map<string, RepositoryModule["action"][]>();
  for (const item of modules) actions.set(item.name, [...(actions.get(item.name) ?? []), item.action]);
  const importable: string[] = [];
  const blocked: string[] = [];
  const absent: string[] = [];
  for (const name of new Set(wanted)) {
    const found = actions.get(name);
    if (!found) absent.push(name);
    else if (found.some((action) => action !== "blocked")) importable.push(name);
    else blocked.push(name);
  }
  return { importable, blocked, absent };
}
