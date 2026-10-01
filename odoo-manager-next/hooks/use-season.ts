"use client";

import { useSyncExternalStore } from "react";
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
