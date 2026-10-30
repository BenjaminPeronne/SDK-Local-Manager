/** Contrôles immédiats alignés sur validate_new_db ; le serveur revérifie au lancement. */
export function databaseNameError(name: string, existing: readonly string[] = []): string {
  if (!name) return "Saisis un nom pour la nouvelle base.";
  if (/[\x00-\x1f\x7f]/.test(name)) return "Le nom contient un caractère de contrôle interdit.";
  if (new TextEncoder().encode(name).length > 63) return "Le nom dépasse 63 octets ; raccourcis-le.";
  if (name === "." || name === "..") return "Ce nom ne peut pas être utilisé pour une base.";
  if (name !== name.trim() || /[/\\]/.test(name))
    return "Retire les espaces aux extrémités et les barres obliques du nom.";
  if (existing.includes(name)) return "Une base de ce nom figure déjà dans le projet.";
  return "";
}
