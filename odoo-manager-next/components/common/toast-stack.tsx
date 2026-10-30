"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import type { Toast } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Attribut des notifications : une fenêtre ouverte ne se ferme pas quand on clique dessus. */
export const TOAST_REGION_ATTRIBUTE = "data-toast-region";

const BASE_DURATION: Record<Toast["kind"], number> = { success: 4500, info: 6000, error: 10000 };

/** Un long message reste affiché plus longtemps : de quoi le lire. */
export function toastDuration(toast: Pick<Toast, "kind" | "message">) {
  return BASE_DURATION[toast.kind] + Math.min(8000, Math.max(0, toast.message.length - 120) * 30);
}

const KIND_STYLES: Record<Toast["kind"], { icon: typeof Info; container: string; iconColor: string }> = {
  success: {
    icon: CheckCircle2,
    container:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    icon: TriangleAlert,
    container: "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
    iconColor: "text-red-600 dark:text-red-400",
  },
  info: {
    icon: Info,
    container: "bg-card text-card-foreground",
    iconColor: "text-primary",
  },
};

const subscribeNothing = () => () => undefined;

/**
 * Notifications en bas à droite, au-dessus des fenêtres ouvertes.
 *
 * Rendues hors de l'application (portail dans <body>) : le thème Radix crée son propre plan
 * d'empilement, et les fenêtres, ajoutées après lui, recouvraient les notifications. `raised` les
 * remonte au-dessus de la barre d'actions flottante des modules.
 */
export function ToastStack({
  toasts,
  raised,
  onDismiss,
  onViewErrors,
}: {
  toasts: Toast[];
  raised: boolean;
  onDismiss: (id: number) => void;
  onViewErrors: () => void;
}) {
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(
    <div
      {...{ [TOAST_REGION_ATTRIBUTE]: "" }}
      role="region"
      aria-label="Notifications"
      className={cn(
        "pointer-events-none fixed bottom-4 left-4 right-4 z-[1000] flex flex-col items-stretch gap-2 sm:left-auto sm:w-[23rem]",
        raised && "bottom-28 xl:bottom-20",
      )}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} onViewErrors={onViewErrors} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({
  toast,
  onDismiss,
  onViewErrors,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
  onViewErrors: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toastDuration(toast));
  const startedAt = useRef(0);

  // Une répétition du même message relance le délai complet.
  useEffect(() => {
    remaining.current = toastDuration(toast);
  }, [toast]);

  // Survolée ou parcourue au clavier, la notification attend qu'on ait fini de la lire.
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), Math.max(remaining.current, 1500));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, toast.id, toast.shownAt, onDismiss]);

  const style = KIND_STYLES[toast.kind];
  const Icon = style.icon;
  const action =
    toast.action ??
    (toast.kind === "error" ? { label: "Voir le journal des erreurs", onClick: onViewErrors } : undefined);
  const content = (
    <>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconColor)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block max-h-40 overflow-y-auto whitespace-pre-line break-words">{toast.message}</span>
        {action && (
          <span className="mt-1.5 block text-xs font-semibold underline underline-offset-2">
            {action.label} <span aria-hidden="true">→</span>
          </span>
        )}
      </span>
      {(toast.count ?? 1) > 1 && (
        <span
          className="mt-0.5 shrink-0 rounded-full bg-black/5 px-1.5 text-[11px] font-medium tabular-nums dark:bg-white/10"
          title={`Reçu ${toast.count} fois`}
        >
          ×{toast.count}
        </span>
      )}
    </>
  );
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-1 rounded-lg border p-1.5 text-sm shadow-lg",
        style.container,
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      {action ? (
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
          onClick={() => {
            action.onClick();
            onDismiss(toast.id);
          }}
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2.5 px-1.5 py-1">{content}</div>
      )}
      <button
        type="button"
        className="shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
        aria-label="Fermer la notification"
        title="Fermer"
        onClick={() => onDismiss(toast.id)}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
