"use client";

import { useCallback, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { Toast } from "@/lib/types";

type Schedule = (callback: () => void, delay: number) => void;

/** Notifications éphémères ; les erreurs sont aussi remontées au journal du backend. */
export function useToasts(schedule: Schedule) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(1);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = toastId.current++;
    setToasts((current) => [...current, { id, kind, message }]);
    schedule(() => setToasts((current) => current.filter((toast) => toast.id !== id)), kind === "error" ? 8000 : 4200);
    if (kind === "error") {
      void fetch(`${API_BASE}/api/errors/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      }).catch(() => undefined);
    }
  }, [schedule]);

  return { toasts, pushToast };
}
