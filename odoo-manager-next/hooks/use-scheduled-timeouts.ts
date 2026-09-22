"use client";

import { useCallback, useEffect, useRef } from "react";

/** Minuteries annulées au démontage : un rappel ne touche jamais un composant disparu. */
export function useScheduledTimeouts() {
  const scheduledTimeouts = useRef<Set<number>>(new Set());

  useEffect(
    () => () => {
      for (const timeout of scheduledTimeouts.current) window.clearTimeout(timeout);
      scheduledTimeouts.current.clear();
    },
    [],
  );

  return useCallback((callback: () => void | Promise<void>, delay: number) => {
    const timeout = window.setTimeout(() => {
      scheduledTimeouts.current.delete(timeout);
      void callback();
    }, delay);
    scheduledTimeouts.current.add(timeout);
  }, []);
}
