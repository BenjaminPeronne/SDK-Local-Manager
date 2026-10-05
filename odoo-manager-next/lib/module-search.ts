import { normalizeSearchText } from "./format.ts";
import type { ModuleInfo } from "./types";

// Qualité de la correspondance, de la meilleure à la plus faible.
const EXACT = 0;
const WORD_START = 1;
const ANYWHERE = 2;
// Une application passe devant les modules complémentaires, sauf face à une correspondance
// nettement meilleure : « sale » trouve d'abord l'application Ventes (sale_management, qui
// commence par « sale »), mais « purchase_stock » tapé en entier trouve ce module en premier.
const COMPLEMENTARY_MODULE_PENALTY = 1.5;

function matchQuality(text: string, query: string) {
  if (!text) return null;
  if (text === query) return EXACT;
  if (text.split(/[^a-z0-9]+/).some((word) => word.startsWith(query))) return WORD_START;
  return text.includes(query) ? ANYWHERE : null;
}

/** Note d'un module pour une recherche (plus petite = plus pertinent), ou null s'il ne correspond pas. */
export function moduleSearchScore(module: ModuleInfo, query: string) {
  const qualities = [matchQuality(normalizeSearchText(module.title || ""), query), matchQuality(module.name, query)];
  const found = qualities.filter((quality): quality is number => quality !== null);
  if (!found.length) return null;
  return Math.min(...found) + (module.application ? 0 : COMPLEMENTARY_MODULE_PENALTY);
}

/**
 * Modules qui correspondent à la recherche, les plus pertinents d'abord : l'application avant ses
 * modules complémentaires, puis le titre exact, puis un mot qui commence par la recherche.
 * Sans recherche, la liste garde son ordre.
 */
export function searchModules(modules: ModuleInfo[], search: string) {
  // Sans accents ni majuscules : « etat » trouve « État ».
  const query = normalizeSearchText(search.trim());
  if (!query) return modules;
  return modules
    .map((module) => ({ module, score: moduleSearchScore(module, query) }))
    .filter((entry): entry is { module: ModuleInfo; score: number } => entry.score !== null)
    .sort(
      (first, second) =>
        first.score - second.score ||
        (first.module.title || first.module.name).localeCompare(second.module.title || second.module.name, "fr"),
    )
    .map((entry) => entry.module);
}
