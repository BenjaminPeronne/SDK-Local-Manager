/** Fête qui décore l'interface. Les suivantes s'ajoutent ici et dans `seasonAt`. */
export type Season = "christmas" | "new-year";

const SEASONS: readonly string[] = ["christmas", "new-year"] satisfies readonly Season[];

/** Fête en cours à cette date, en heure locale : Noël du 1er au 30 décembre, Nouvel An du 31 au 2 janvier. */
export function seasonAt(date: Date): Season | null {
  const month = date.getMonth();
  const day = date.getDate();
  if (month === 11) return day <= 30 ? "christmas" : "new-year";
  if (month === 0 && day <= 2) return "new-year";
  return null;
}

/**
 * Saison imposée par l'adresse, pour tester ou faire des captures hors période : `?season=christmas`
 * ou `?season=new-year` l'affiche, toute autre valeur (`?season=none`) l'éteint. `undefined` : rien
 * d'imposé. `scripts/preview_seasons.py` ouvre chaque cas.
 */
export function seasonOverride(search: string): Season | null | undefined {
  const value = new URLSearchParams(search).get("season");
  if (value === null) return undefined;
  return SEASONS.includes(value) ? (value as Season) : null;
}

/** `?confetti=1` lance une salve dès l'ouverture, en période de Nouvel An : aperçu sans attendre une action. */
export function confettiPreviewRequested(search: string) {
  return new URLSearchParams(search).get("confetti") === "1";
}

/** Vœux du Nouvel An : le 31 décembre annonce l'année qui arrive, ensuite on la souhaite. */
export function newYearGreeting(date: Date) {
  if (date.getMonth() === 11) return `Bientôt ${date.getFullYear() + 1} ! Belle fin d’année 🎉`;
  return `Bonne année ${date.getFullYear()} ! 🎉`;
}

/** Jour local au format AAAA-MM-JJ : les confettis ne sont lancés qu'une fois par jour. */
export function localDayKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
