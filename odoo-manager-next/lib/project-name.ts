/**
 * Nom d'un nouveau projet, mis en forme pendant la saisie.
 *
 * Le nom devient l'adresse du projet (dev.<nom>.localhost), le dossier et les conteneurs Docker :
 * minuscules, chiffres, points, tirets et underscores, commençant par une lettre ou un chiffre.
 * Les utilisateurs tapent volontiers « CLIENT V19 » : plutôt qu'un refus, le nom est converti
 * (« client_v19 »). Même règle que `normalize_project_name` côté backend.
 */

export const PROJECT_NAME_MAX_LENGTH = 63;

const LIGATURES: Record<string, string> = { æ: "ae", œ: "oe", ß: "ss" };

/**
 * `final` retire aussi les séparateurs de fin : pendant la saisie, « client_ » doit rester
 * tapable avant la suite du nom.
 */
export function normalizeProjectName(value: string, { final = false }: { final?: boolean } = {}) {
  let name = value
    .toLowerCase()
    .replace(/[æœß]/g, (letter) => LIGATURES[letter] ?? letter)
    // « é » devient « e » + accent combinant, retiré ensuite.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Espaces, apostrophes, barres… : un seul underscore par groupe de caractères refusés.
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^[._-]+/, "");
  if (final) name = name.replace(/[._-]+$/, "");
  return name.slice(0, PROJECT_NAME_MAX_LENGTH);
}

/** Projet existant au même nom, casse ignorée : dev.AKAAZ et dev.akaaz sont la même adresse. */
export function existingProjectNamed(name: string, projects: { name: string }[]) {
  const wanted = name.toLowerCase();
  return wanted ? projects.find((project) => project.name.toLowerCase() === wanted) : undefined;
}
