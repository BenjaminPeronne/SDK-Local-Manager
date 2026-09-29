"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DependencyReport } from "@/lib/types";

/**
 * Dépendances manquantes de la base sélectionnée, relues à chaque changement de base.
 *
 * Une erreur de lecture (PostgreSQL arrêté) ne remonte pas en alerte : le rapport reste vide.
 */
export function useDatabaseDependencies(project: string | undefined, db: string, enabled: boolean) {
  const [report, setReport] = useState<DependencyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!project || !db || !enabled) return;
    setLoading(true);
    setError("");
    try {
      setReport(
        await api<DependencyReport>(
          `/api/projects/${encodeURIComponent(project)}/dependencies?db=${encodeURIComponent(db)}`,
        ),
      );
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Lecture des dépendances impossible.");
    } finally {
      setLoading(false);
    }
  }, [project, db, enabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Le rapport d'une autre base n'est jamais affiché pour la base courante.
  const current = report && report.project === project && report.db === db ? report : null;
  return { report: current, loading, error, refresh };
}
