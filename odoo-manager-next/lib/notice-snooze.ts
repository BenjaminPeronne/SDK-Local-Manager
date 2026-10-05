/** Un bandeau masqué pour un temps revient ensuite : le rappel ne disparaît jamais pour de bon. */
export const NOTICE_SNOOZE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Vrai tant que le bandeau masqué à `dismissedAt` (millisecondes, telles que mémorisées) reste caché.
 * Une heure à venir (horloge du poste corrigée depuis) ne masque rien : le bandeau ne doit pas
 * disparaître plus longtemps que prévu.
 */
export function noticeSnoozed(dismissedAt: string, now = Date.now()) {
  const at = Number(dismissedAt);
  return Number.isFinite(at) && at > 0 && at <= now && now - at < NOTICE_SNOOZE_DAYS * DAY_MS;
}
