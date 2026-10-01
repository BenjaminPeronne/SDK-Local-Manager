/** Fête qui décore l'interface. Noël seulement pour l'instant ; les suivantes s'ajoutent ici. */
export type Season = "christmas";

const SEASONS: readonly string[] = ["christmas"] satisfies readonly Season[];

/** Fête en cours à cette date, en heure locale : Noël du 1er au 30 décembre, le 31 revenant au Nouvel An. */
export function seasonAt(date: Date): Season | null {
  if (date.getMonth() === 11 && date.getDate() <= 30) return "christmas";
  return null;
}

/**
 * Saison imposée par l'adresse, pour tester ou faire des captures hors période : `?season=christmas`
 * l'affiche, toute autre valeur (`?season=none`) l'éteint. `undefined` : rien d'imposé.
 */
export function seasonOverride(search: string): Season | null | undefined {
  const value = new URLSearchParams(search).get("season");
  if (value === null) return undefined;
  return SEASONS.includes(value) ? (value as Season) : null;
}
