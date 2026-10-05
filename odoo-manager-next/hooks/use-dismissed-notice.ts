"use client";

import { useCallback, useState } from "react";

function readDismissed(storageKey: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(storageKey) || "";
  } catch {
    return "";
  }
}

/**
 * Bandeau masqué par l'utilisateur pour une valeur précise : le dossier des projets (il revient
 * quand le dossier change), ou l'heure du masquage (il revient au bout d'un temps, voir
 * lib/notice-snooze.ts). Le choix est mémorisé sur ce poste.
 */
export function useDismissedNotice(name: string) {
  const storageKey = `sdk-local-manager.dismissed-notice.${name}`;
  const [dismissedFor, setDismissedFor] = useState(() => readDismissed(storageKey));
  const dismiss = useCallback(
    (value: string) => {
      try {
        window.localStorage.setItem(storageKey, value);
      } catch {
        // Stockage indisponible : le bandeau reste masqué jusqu'au prochain lancement.
      }
      setDismissedFor(value);
    },
    [storageKey],
  );
  return [dismissedFor, dismiss] as const;
}
