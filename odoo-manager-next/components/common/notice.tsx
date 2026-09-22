"use client";

import type { ReactNode } from "react";
import { type LucideIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Bandeau d'information de la zone principale.
 *
 * Chaque bandeau reprenait son propre assemblage : couleurs, marges et boutons dérivaient de
 * l'un à l'autre. Tous passent par ce composant : même structure, même rythme, même bouton
 * de fermeture quand le bandeau peut être masqué.
 */
type NoticeTone = "danger" | "warning" | "info" | "success" | "neutral" | "accent";

const NOTICE_TONES: Record<NoticeTone, { container: string; bar: string; icon: string; body: string; dismiss: string }> = {
  danger: {
    container: "border-red-200 bg-red-50/80 text-red-950 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-50",
    bar: "bg-red-500",
    icon: "bg-red-100 text-red-600 dark:bg-red-900/60 dark:text-red-300",
    body: "text-red-800 dark:text-red-200",
    dismiss: "text-red-800 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-900/60",
  },
  warning: {
    container: "border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-50",
    bar: "bg-amber-500",
    icon: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
    body: "text-amber-800 dark:text-amber-200",
    dismiss: "text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/60",
  },
  info: {
    container: "border-sky-200 bg-sky-50/80 text-sky-950 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-50",
    bar: "bg-sky-500",
    icon: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300",
    body: "text-sky-800 dark:text-sky-200",
    dismiss: "text-sky-800 hover:bg-sky-100 dark:text-sky-200 dark:hover:bg-sky-900/60",
  },
  success: {
    container: "border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-50",
    bar: "bg-emerald-500",
    icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300",
    body: "text-emerald-800 dark:text-emerald-200",
    dismiss: "text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/60",
  },
  neutral: {
    container: "border-slate-200 bg-slate-50/80 text-slate-900 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-100",
    bar: "bg-slate-400",
    icon: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    body: "text-slate-700 dark:text-slate-300",
    dismiss: "text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800",
  },
  accent: {
    container: "border-primary/30 bg-primary/[0.06] text-foreground dark:bg-primary/[0.12]",
    bar: "bg-primary",
    icon: "bg-primary/15 text-primary",
    body: "text-muted-foreground",
    dismiss: "text-muted-foreground hover:bg-primary/10 hover:text-foreground",
  },
};

export function Notice({
  tone,
  icon: Icon,
  title,
  children,
  actions,
  onDismiss,
  dismissLabel = "Fermer",
}: {
  tone: NoticeTone;
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const style = NOTICE_TONES[tone];
  return (
    <section
      role={tone === "danger" ? "alert" : "status"}
      className={cn("relative mb-3 overflow-hidden rounded-lg border shadow-sm", style.container)}
    >
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", style.bar)} />
      <div className={cn("flex flex-col gap-3 py-3.5 pl-5 pr-4 sm:flex-row sm:items-center", onDismiss && "pr-11")}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", style.icon)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 pt-1 text-sm">
            <div className="font-semibold leading-5">{title}</div>
            {children && <div className={cn("mt-1 break-words leading-relaxed", style.body)}>{children}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:pl-3">{actions}</div>}
      </div>
      {onDismiss && (
        <Button
          size="icon"
          variant="ghost"
          className={cn("absolute right-2 top-2 h-7 w-7", style.dismiss)}
          title={dismissLabel}
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">{dismissLabel}</span>
        </Button>
      )}
    </section>
  );
}
