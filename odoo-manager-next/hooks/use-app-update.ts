"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AppUpdate } from "@/lib/types";

const DISMISSED_UPDATE_KEY = "sdk-local-manager.dismissed-update";

function readDismissedVersion() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Nouvelle version publiée sur GitLab, lue une fois le service local prêt.
 *
 * L'annonce masquée ne revient qu'avec une version plus récente encore. Sans accès à GitLab,
 * rien n'est affiché : la vérification ne doit jamais gêner le travail.
 */
export function useAppUpdate(enabled: boolean) {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  // Lu au premier rendu : l'annonce n'apparaît qu'après la réponse du service, jamais au prérendu.
  const [dismissedVersion, setDismissedVersion] = useState(readDismissedVersion);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api<AppUpdate>("/api/app-update")
      .then((payload) => {
        if (!cancelled) setUpdate(payload);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  function dismiss() {
    if (!update?.latest) return;
    setDismissedVersion(update.latest);
    try {
      window.localStorage.setItem(DISMISSED_UPDATE_KEY, update.latest);
    } catch {
      // Stockage indisponible : l'annonce reviendra au prochain lancement.
    }
  }

  const available = update?.update_available && update.latest !== dismissedVersion ? update : null;
  return { availableUpdate: available, dismissUpdate: dismiss };
}
