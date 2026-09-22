"use client";

import type { RefObject } from "react";
import { Logs } from "lucide-react";
import { Button } from "@/components/ui/button";

// Ligne de synthèse produite par odoo_log_display.py quand des traces non bloquantes sont résumées.
const CONDENSED_ODOO_LOG_RE = /^Info Odoo \(.*\) : \d+ fichier\(s\) déjà absent\(s\) lors du nettoyage du filestore\./m;

export function OdooLogsModeBar({
  view,
  onShowFull,
  onShowSummary,
}: {
  view: { content: string; logs?: "summary" | "full" } | null;
  onShowFull: () => void;
  onShowSummary: () => void;
}) {
  if (!view?.logs) return null;
  if (view.logs === "summary" && !CONDENSED_ODOO_LOG_RE.test(view.content)) return null;
  const full = view.logs === "full";
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-md border bg-muted/35 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-muted-foreground">
        {full
          ? "Traces complètes : les erreurs non bloquantes du nettoyage du filestore ne sont pas résumées."
          : "Des traces non bloquantes du nettoyage du filestore ont été résumées."}
      </span>
      <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={full ? onShowSummary : onShowFull}>
        <Logs className="h-4 w-4" />
        {full ? "Revenir aux logs résumés" : "Voir les traces complètes"}
      </Button>
    </div>
  );
}

export function JobOutputPre({
  outputRef,
  content,
  hidden,
  onScroll,
}: {
  outputRef: RefObject<HTMLPreElement | null>;
  content: string;
  hidden?: boolean;
  onScroll: () => void;
}) {
  return (
    <pre
      ref={outputRef}
      hidden={hidden}
      className="log-terminal min-h-[260px] max-h-[min(58vh,620px)] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-xs leading-relaxed text-emerald-100 sm:p-4"
      onScroll={onScroll}
    >
      {content}
    </pre>
  );
}
