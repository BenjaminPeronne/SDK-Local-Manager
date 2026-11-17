/** Ordre de deux versions « 0.51.0 » : négatif si `left` est plus ancienne. */
export function compareVersions(left: string, right: string) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

/**
 * Ouvrir les nouveautés au lancement : seulement juste après une mise à jour.
 * Premier lancement (rien de retenu) : rien à annoncer, la version est seulement retenue.
 */
export function shouldAnnounceReleaseNotes(seenVersion: string | null, currentVersion: string) {
  return Boolean(seenVersion) && compareVersions(seenVersion as string, currentVersion) < 0;
}

/** « 2026-11-17 » → « 17 novembre 2026 ». */
export function formatReleaseDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
