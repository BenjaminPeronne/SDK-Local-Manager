import type { Job, ModuleSourcePlan, ModuleSourceRepository, ModuleSourcesResult } from "./types";

/** Résultat de recherche porté par une action, ou null pour toute autre action. */
export function moduleSourcesResult(job: Pick<Job, "result"> | null | undefined): ModuleSourcesResult | null {
  const result = job?.result as Partial<ModuleSourcesResult> | undefined;
  return result?.kind === "module_sources" && Array.isArray(result.searched) ? (result as ModuleSourcesResult) : null;
}

/** Dernière recherche lancée pour le projet, en cours ou terminée. */
export function latestModuleSourcesJob(jobs: Job[], project: string | undefined) {
  let latest: Job | null = null;
  for (const job of jobs) {
    if (job.project === project && moduleSourcesResult(job) && (!latest || job.id > latest.id)) latest = job;
  }
  return latest;
}

/** « OCA/edi » pour gitlab.sudokeys.com/OCA/edi : le serveur est toujours le même. */
export function shortRepositoryLabel(label: string) {
  return label.split("/").slice(1).join("/") || label;
}

export type ModuleSourceGroup = { repository: ModuleSourceRepository; modules: ModuleSourcePlan[] };

export type ModuleSourcesPlan = {
  /** Un import par dépôt, celui qui fournit le plus de modules en premier. */
  groups: ModuleSourceGroup[];
  /** Trouvés, mais aucun dépôt ne peut les importer (version d'Odoo, nom invalide…). */
  blocked: { name: string; repository: ModuleSourceRepository; reason: string }[];
  /** Cherchés, introuvables dans les dépôts lus. */
  absent: string[];
  /** Manquants apparus après la recherche : une nouvelle recherche est nécessaire. */
  unsearched: string[];
  found: number;
};

/**
 * Dépôt retenu pour chacun des modules manquants : le moins de dépôts possible, celui qui en fournit
 * le plus d'abord, un dépôt déjà utilisé par le projet en cas d'égalité. Un module qui n'existe que
 * sous une forme non importable est rangé à part, avec la raison donnée par le premier dépôt.
 */
export function planModuleSources(result: ModuleSourcesResult, missing: string[]): ModuleSourcesPlan {
  const searched = new Set(result.searched);
  const repositories = result.repositories ?? [];
  const wanted = [...new Set(missing)].sort();
  const remaining = new Set(wanted.filter((name) => searched.has(name)));
  const candidates = repositories.map((repository) => {
    const plans = new Map<string, ModuleSourcePlan>();
    for (const plan of repository.modules) {
      if (plan.action !== "blocked" && !plans.has(plan.name)) plans.set(plan.name, plan);
    }
    return { repository, plans };
  });
  const groups: ModuleSourceGroup[] = [];
  for (;;) {
    let best: (typeof candidates)[number] | null = null;
    let bestCount = 0;
    for (const candidate of candidates) {
      const count = [...candidate.plans.keys()].filter((name) => remaining.has(name)).length;
      if (
        count > bestCount ||
        (count > 0 && count === bestCount && candidate.repository.in_project && !best?.repository.in_project)
      ) {
        best = candidate;
        bestCount = count;
      }
    }
    if (!best) break;
    const chosen = best;
    const modules = wanted
      .filter((name) => remaining.has(name) && chosen.plans.has(name))
      .map((name) => {
        remaining.delete(name);
        return chosen.plans.get(name) as ModuleSourcePlan;
      });
    groups.push({ repository: chosen.repository, modules });
    candidates.splice(candidates.indexOf(chosen), 1);
  }
  const blocked: ModuleSourcesPlan["blocked"] = [];
  const absent: string[] = [];
  for (const name of remaining) {
    const repository = repositories.find((item) => item.modules.some((plan) => plan.name === name));
    const plan = repository?.modules.find((item) => item.name === name);
    if (repository && plan) blocked.push({ name, repository, reason: plan.reason });
    else absent.push(name);
  }
  return {
    groups,
    blocked,
    absent,
    unsearched: wanted.filter((name) => !searched.has(name)),
    found: groups.reduce((total, group) => total + group.modules.length, 0),
  };
}
