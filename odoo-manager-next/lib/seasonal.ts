/** Fête qui décore l'interface. Les suivantes s'ajoutent ici et dans `seasonAt`. */
export type Season = "easter" | "halloween" | "christmas" | "new-year";

const SEASONS: readonly string[] = ["easter", "halloween", "christmas", "new-year"] satisfies readonly Season[];

/** Dimanche de Pâques de l'année, à minuit en heure locale (calcul grégorien de Meeus, Jones et Butcher). */
export function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

/**
 * Fête en cours à cette date, en heure locale : Pâques du dimanche des Rameaux au lundi de Pâques
 * (date différente chaque année), Halloween du 25 au 31 octobre, Noël du 1er au 30 décembre, Nouvel An
 * du 31 décembre au 2 janvier.
 */
export function seasonAt(date: Date): Season | null {
  const month = date.getMonth();
  const day = date.getDate();
  const easter = easterSunday(date.getFullYear());
  const today = new Date(date.getFullYear(), month, day);
  // Écart en jours calendaires ; l'arrondi absorbe le changement d'heure de fin mars.
  const fromEaster = Math.round((today.getTime() - easter.getTime()) / 86_400_000);
  if (fromEaster >= -7 && fromEaster <= 1) return "easter";
  if (month === 9 && day >= 25) return "halloween";
  if (month === 11) return day <= 30 ? "christmas" : "new-year";
  if (month === 0 && day <= 2) return "new-year";
  return null;
}

/**
 * Saison imposée par l'adresse, pour tester ou faire des captures hors période : `?season=easter`,
 * `?season=halloween`, `?season=christmas` ou `?season=new-year` l'affiche, toute autre valeur (`?season=none`) l'éteint. `undefined` : rien
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
