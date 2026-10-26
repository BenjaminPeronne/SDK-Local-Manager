"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { seasonAt, seasonOverride, type Season } from "@/lib/seasonal";

// L'application reste souvent ouverte plusieurs jours : la saison est revue toutes les heures.
const SEASON_RECHECK_MS = 60 * 60 * 1000;

function subscribe(onChange: () => void) {
  const timer = window.setInterval(onChange, SEASON_RECHECK_MS);
  return () => window.clearInterval(timer);
}

function currentSeason() {
  const forced = seasonOverride(window.location.search);
  return forced === undefined ? seasonAt(new Date()) : forced;
}

/** Fête à décorer aujourd'hui ; aucune au prérendu ou quand les décorations sont coupées. */
export function useSeason(enabled: boolean): Season | null {
  const season = useSyncExternalStore(subscribe, currentSeason, () => null);
  return enabled ? season : null;
}

// Sans geste de la souris ni du clavier pendant ce délai, on considère que personne ne regarde.
const SEASON_IDLE_MS = 60 * 1000;
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel"] as const;

/**
 * Vrai quand les décorations animées peuvent se reposer : fenêtre au second plan ou personne devant
 * depuis une minute. Elles s'estompent et se figent alors (`data-season-resting`), et l'affichage
 * cesse de se renouveler ; le premier geste les relance.
 */
export function useSeasonResting(season: Season | null) {
  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (!season) return;
    let idleTimer = 0;
    const wake = () => {
      window.clearTimeout(idleTimer);
      if (!document.hasFocus()) {
        setResting(true);
        return;
      }
      setResting(false);
      idleTimer = window.setTimeout(() => setResting(true), SEASON_IDLE_MS);
    };
    const rest = () => {
      window.clearTimeout(idleTimer);
      setResting(true);
    };
    wake();
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, wake, { passive: true });
    window.addEventListener("focus", wake);
    window.addEventListener("blur", rest);
    return () => {
      window.clearTimeout(idleTimer);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("blur", rest);
    };
  }, [season]);
  return season !== null && resting;
}
