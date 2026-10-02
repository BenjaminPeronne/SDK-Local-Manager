"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AppUpdate } from "@/lib/types";

const DISMISSED_UPDATE_KEY = "sdk-local-manager.dismissed-update";
// Une application ouverte plusieurs jours voit aussi les nouvelles versions : le service local
// garde sa réponse six heures, l'interface la redemande au même rythme.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function readDismissedVersion() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_KEY) || "";
  } catch {
    return "";
  }
}

function writeDismissedVersion(version: string) {
  try {
    if (version) window.localStorage.setItem(DISMISSED_UPDATE_KEY, version);
    else window.localStorage.removeItem(DISMISSED_UPDATE_KEY);
  } catch {
    // Stockage indisponible : l'annonce reviendra au prochain lancement.
  }
}

/**
 * Nouvelle version publiée sur GitLab : lue au démarrage du service local, puis toutes les six
 * heures, ou tout de suite avec `checkNow` (« Rechercher une mise à jour » dans « À propos »).
 *
 * L'annonce masquée ne revient qu'avec une version plus récente encore, ou par une recherche
 * demandée. Sans accès à GitLab, l'annonce reste absente ; « À propos » en donne la raison.
 */
export function useAppUpdate(enabled: boolean) {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  // Le service local lui-même n'a pas répondu à une recherche demandée.
  const [checkFailure, setCheckFailure] = useState("");
  // Lu au premier rendu : l'annonce n'apparaît qu'après la réponse du service, jamais au prérendu.
  const [dismissedVersion, setDismissedVersion] = useState(readDismissedVersion);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const read = () =>
      api<AppUpdate>("/api/app-update")
        .then((payload) => {
          if (!cancelled) setUpdate(payload);
        })
        .catch(() => undefined);
    void read();
    const timer = window.setInterval(() => void read(), RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  const checkNow = useCallback(async () => {
    setChecking(true);
    setCheckFailure("");
    try {
      const payload = await api<AppUpdate>("/api/app-update?refresh=1");
      setUpdate(payload);
      // Recherche demandée : une version masquée revient aussi dans la barre latérale.
      if (payload.update_available) {
        setDismissedVersion("");
        writeDismissedVersion("");
      }
    } catch {
      setCheckFailure("Le service local ne répond pas : réessaie dans un instant.");
    } finally {
      setChecking(false);
    }
  }, []);

  function dismiss() {
    if (!update?.latest) return;
    setDismissedVersion(update.latest);
    writeDismissedVersion(update.latest);
  }

  const available = update?.update_available && update.latest !== dismissedVersion ? update : null;
  return { update, availableUpdate: available, dismissUpdate: dismiss, checkNow, checking, checkFailure };
}
