import type { ModuleInfo, ModuleRepository } from "./types";

/** Groupe de la vue par dépôt ; `repository` est absent pour les modules sans dépôt connu. */
export type ModuleRepositoryGroup = {
  id: string;
  repository: ModuleRepository | null;
  modules: ModuleInfo[];
  installed: number;
  copies: number;
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
      copies: members.filter((module) => module.repository_copy).length,
    };
  };
  const projectGroups = repositories.filter((repository) => !repository.standard).map((r) => group(r.id, r));
  const standardGroups = repositories.filter((repository) => repository.standard).map((r) => group(r.id, r));
  return [...projectGroups, group(NO_REPOSITORY_GROUP, null), ...standardGroups].filter(
    (item): item is ModuleRepositoryGroup => item !== null,
  );
}

/** Ce que le dépôt a de chargé : branche, sinon étiquette, sinon commit. */
export function repositoryRevision(repository: ModuleRepository) {
  if (repository.branch) return { kind: "branch" as const, label: repository.branch };
  if (repository.tag) return { kind: "tag" as const, label: repository.tag };
  if (repository.commit) return { kind: "commit" as const, label: repository.commit.slice(0, 7) };
  return null;
}
