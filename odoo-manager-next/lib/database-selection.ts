// Base de travail d'un projet : laquelle garder quand la liste des bases change.
//
// La liste arrive à chaque rafraîchissement du tableau de bord. Une sonde Postgres lente ou un
// projet qui redémarre la rend parfois vide un instant : la base choisie était alors oubliée,
// puis la première de la liste reprenait sa place au rafraîchissement suivant.

/**
 * Base à conserver pour un projet.
 *
 * - liste vide : Postgres ne répond pas encore, ce n'est pas une raison d'oublier le choix ;
 * - base courante toujours présente : elle reste ;
 * - sinon, la dernière base choisie pour ce projet pendant la session, si elle existe encore ;
 * - en dernier recours seulement, la première base de la liste.
 */
export function databaseToKeep(databases: readonly string[] | undefined, current: string, remembered?: string): string {
  const odooDatabases = (databases ?? []).filter((database) => database !== "postgres");
  if (odooDatabases.length === 0) return current;
  if (current && odooDatabases.includes(current)) return current;
  if (remembered && odooDatabases.includes(remembered)) return remembered;
  return odooDatabases[0];
}

// Mémoire de la session : elle survit à un rechargement de la fenêtre, pas à la fermeture de
// l'application. Le choix vaut pour l'instance en cours, pas pour toujours.
const REMEMBERED_DATABASES_KEY = "sdk-local-manager:selected-databases";

export function readRememberedDatabases(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(REMEMBERED_DATABASES_KEY) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function writeRememberedDatabases(value: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(REMEMBERED_DATABASES_KEY, JSON.stringify(value));
  } catch {
    // Stockage indisponible (navigation privée, quota) : la mémoire reste valable en mémoire vive.
  }
}
