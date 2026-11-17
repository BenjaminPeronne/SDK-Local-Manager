"use client";

import { useEffect, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { api } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";
import type { Job, ResourcesReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Relecture pendant que la fenêtre est ouverte : `docker stats` met déjà 1 à 2 s à répondre.
const REFRESH_MS = 4000;

function percent(value: number) {
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

/** Barre fine sous un pourcentage : la charge se lit d'un coup d'œil. */
function Meter({ value }: { value: number }) {
  return (
    <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <span
        className="block h-full rounded-full bg-primary"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </span>
  );
}

/** Ce que prend chaque projet allumé sur l'ordinateur, comme Docker Desktop, avec un bouton pour l'éteindre. */
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
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | undefined;
    async function load() {
      try {
        const payload = await api<ResourcesReport>("/api/system/resources");
        if (!cancelled) {
          setReport(payload);
          setNow(Date.now() / 1000);
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ressources des projets</DialogTitle>
          <DialogDescription>
            Ce que chaque projet allumé prend sur l’ordinateur. Éteins ceux dont tu ne te sers pas.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!report && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Lecture en cours…
          </p>
        )}
        {report && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Processeur de l’ordinateur ({report.host.cpus} cœurs)</p>
              <p className="font-semibold tabular-nums">{percent(report.docker.cpu_percent)} utilisés par Docker</p>
              <Meter value={report.docker.cpu_percent} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Mémoire de l’ordinateur ({formatBytes(report.host.memory)})
              </p>
              <p className="font-semibold tabular-nums">
                {percent(report.docker.memory_percent)} utilisés par Docker ({formatBytes(report.docker.memory_used)})
              </p>
              <Meter value={report.docker.memory_percent} />
            </div>
            {report.docker.memory > 0 && (
              <p className="col-span-2 text-xs text-muted-foreground">
                Docker ne peut pas dépasser {formatBytes(report.docker.memory)} de mémoire et {report.docker.cpus}{" "}
                cœurs.
              </p>
            )}
          </div>
        )}
        {report && !projects.length && <p className="text-sm text-muted-foreground">Aucun projet allumé.</p>}
        {projects.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Projet</th>
                  <th className="w-28 py-1 pl-3 font-medium">Processeur</th>
                  <th className="w-36 py-1 pl-3 font-medium">Mémoire</th>
                  <th className="py-1 pl-3 font-medium">Allumé depuis</th>
                  <th className="py-1">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const busy = busyJobs.get(project.name);
                  const uptime = project.started_at ? now - project.started_at : null;
                  const stopIn = uptime !== null && report?.auto_stop_after ? report.auto_stop_after - uptime : null;
                  return (
                    <tr key={project.name} className="border-t align-top">
                      <td className="py-2 font-semibold uppercase">{project.name}</td>
                      <td className="py-2 pl-3 tabular-nums">
                        {percent(project.cpu_percent)}
                        <Meter value={project.cpu_percent} />
                      </td>
                      <td className="py-2 pl-3 tabular-nums">
                        {percent(project.memory_percent)}
                        <span className="ml-1 text-xs text-muted-foreground">({formatBytes(project.memory)})</span>
                        <Meter value={project.memory_percent} />
                      </td>
                      <td className="py-2 pl-3">
                        {uptime === null ? "—" : formatDuration(uptime)}
                        {stopIn !== null && (
                          <span className="block text-xs text-muted-foreground">
                            {stopIn > 0 ? `Arrêt auto dans ${formatDuration(stopIn)}` : "Arrêt auto imminent"}
                          </span>
                        )}
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
