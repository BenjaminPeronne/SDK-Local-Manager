"use client";

import { useCallback, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { Toast, ToastAction } from "@/lib/types";

// Au-delà, les plus anciens partent : une rafale d'erreurs ne doit pas couvrir l'écran.
export const MAX_VISIBLE_TOASTS = 4;

export type PushToast = (kind: Toast["kind"], message: string, options?: { action?: ToastAction }) => void;

/**
 * Notifications éphémères ; les erreurs sont aussi remontées au journal du backend.
 *
 * Leur disparition est gérée par la pile affichée (pause au survol) : ce hook ne tient que la liste.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback<PushToast>((kind, message, options) => {
    setToasts((current) => {
      const repeated = current.find((toast) => toast.kind === kind && toast.message === message);
      if (repeated) {
        return current.map((toast) =>
          toast === repeated
            ? { ...toast, count: (toast.count ?? 1) + 1, shownAt: Date.now(), action: options?.action ?? toast.action }
            : toast,
        );
      }
      const toast = { id: toastId.current++, kind, message, shownAt: Date.now(), action: options?.action };
      return [...current, toast].slice(-MAX_VISIBLE_TOASTS);
    });
    if (kind === "error") {
      void fetch(`${API_BASE}/api/errors/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      }).catch(() => undefined);
    }
  }, []);

  return { toasts, pushToast, dismissToast };
}
