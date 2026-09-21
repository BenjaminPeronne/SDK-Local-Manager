/**
 * Flèches et Entrée dans une liste pilotée depuis son champ de recherche.
 *
 * Le focus reste dans le champ : on continue de taper pour filtrer, les flèches déplacent la
 * ligne active, Entrée la choisit sans soumettre la fenêtre. Les autres touches restent au champ.
 */
export function handleListKeys(
  event: { key: string; preventDefault(): void },
  count: number,
  active: number,
  setActive: (index: number) => void,
  choose: (index: number) => void,
) {
  if (!count) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActive(Math.min(count - 1, active + 1));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActive(Math.max(0, active - 1));
  } else if (event.key === "Enter") {
    event.preventDefault();
    choose(Math.min(active, count - 1));
  }
}
