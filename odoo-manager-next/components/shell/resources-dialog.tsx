"use client";

import { useEffect, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { Job, ResourcesReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Relecture pendant que la fenêtre est ouverte : `docker stats` met déjà 1 à 2 s à répondre.
const REFRESH_MS = 4000;

/** Ce que prend chaque projet allumé, comme l'onglet Conteneurs de Docker Desktop, avec un bouton pour l'éteindre. */
export function ResourcesDialog({
  open,
  onOpenChange,
  busyJobs,
  stopProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busyJobs: Map<string, Job>;
  stopProject: (name: string) => Promise<void>;
}) {
  const [report, setReport] = useState<ResourcesReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | undefined;
    async function load() {
      try {
        const payload = await api<ResourcesReport>("/api/system/resources");
        if (!cancelled) {
          setReport(payload);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Lecture impossible.");
      }
      if (!cancelled) timer = window.setTimeout(load, REFRESH_MS);
    }
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open]);

  const projects = report?.projects ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ressources des projets</DialogTitle>
          <DialogDescription>
            Part du processeur et de la mémoire réservés à Docker
            {report?.memory ? ` (${formatBytes(report.memory)})` : ""} prise par chaque projet allumé. Éteins ceux dont
            tu ne te sers pas.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!report && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Lecture en cours…
          </p>
        )}
        {report && !projects.length && <p className="text-sm text-muted-foreground">Aucun projet allumé.</p>}
        {projects.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Projet</th>
                <th className="py-1 text-right font-medium">Processeur</th>
                <th className="py-1 text-right font-medium">Mémoire</th>
                <th className="py-1">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const busy = busyJobs.get(project.name);
                return (
                  <tr key={project.name} className="border-t">
                    <td className="py-2 font-semibold uppercase">{project.name}</td>
                    <td className="py-2 text-right tabular-nums">{project.cpu_percent.toLocaleString("fr-FR")} %</td>
                    <td className="py-2 text-right tabular-nums" title={formatBytes(project.memory)}>
                      {project.memory_percent.toLocaleString("fr-FR")} %
                      <span className="ml-1 text-xs text-muted-foreground">({formatBytes(project.memory)})</span>
                    </td>
                    <td className="py-2 pl-2 text-right">
                      {busy ? (
                        <Loader2
                          className="ml-auto h-4 w-4 animate-spin text-primary"
                          aria-label={`En cours : ${busy.title}`}
                        />
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Arrêter ${project.name}`}
                          onClick={() => void stopProject(project.name)}
                        >
                          <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                          Arrêter
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
