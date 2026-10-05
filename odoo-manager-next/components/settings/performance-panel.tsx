"use client";

import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Cpu, Database, Gauge, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { isJobActive } from "@/lib/jobs";
import type { Job, ManagerSettings, PerformanceReport, Toast } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Notice } from "@/components/common/notice";
import { ConfirmButton } from "@/components/settings/disk-usage-panel";
import { SettingsGroup, SettingsSection } from "@/components/settings/settings-section";

const APPLY_JOB_TITLE = "Donner plus de ressources à Docker Desktop";
const GIB = 1024 ** 3;

/** Mémoire arrondie au Go : Docker annonce 1,9 Go pour 2 Go alloués. */
function formatMemory(bytes: number | undefined) {
  if (!bytes) return "—";
  if (bytes < GIB) return `${Math.round(bytes / 1024 ** 2)} Mo`;
  return `${Math.round(bytes / GIB)} Go`;
}

function processors(count: number | undefined) {
  if (!count) return "—";
  return `${count} processeur${count > 1 ? "s" : ""}`;
}

const STATUS_BADGES: Record<
  PerformanceReport["status"],
  { label: string; variant: "success" | "warning" | "danger" | "outline" }
> = {
  ok: { label: "Adapté", variant: "success" },
  low: { label: "Insuffisant", variant: "warning" },
  critical: { label: "Trop peu", variant: "danger" },
  unknown: { label: "Inconnu", variant: "outline" },
};

function Line({ label, value, extra }: { label: string; value: string; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 font-medium tabular-nums">
        {value}
        {extra}
      </span>
    </div>
  );
}

export function PerformancePanel({
  createJob,
  jobs,
  settingsDraft,
  setSettingsDraft,
  pushToast,
}: {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  jobs: Job[];
  settingsDraft: ManagerSettings;
  setSettingsDraft: Dispatch<SetStateAction<ManagerSettings | null>>;
  pushToast: (kind: Toast["kind"], message: string) => void;
}) {
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api<PerformanceReport>("/api/performance"));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lecture des ressources impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  const applyJobs = useMemo(() => jobs.filter((job) => job.title === APPLY_JOB_TITLE), [jobs]);
  const applying = applyJobs.find(isJobActive);
  // Relu à l'ouverture, puis à la fin de chaque réglage de Docker Desktop.
  const finishedKey = applyJobs
    .filter((job) => !isJobActive(job))
    .map((job) => job.id)
    .join(",");
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, finishedKey]);

  const docker = report?.docker;
  const recommended = report?.recommended;
  const badge = report ? STATUS_BADGES[report.status] : null;

  async function copyWslConfig() {
    if (!report?.wslconfig) return;
    try {
      await navigator.clipboard.writeText(report.wslconfig);
      pushToast("success", "Contenu de .wslconfig copié.");
    } catch {
      pushToast("error", "Copie impossible : sélectionne le texte à la main.");
    }
  }

  return (
    <SettingsSection
      title="Performances"
      description="La mémoire et les processeurs que Docker peut utiliser pour faire tourner tes projets, et les réglages de leurs bases."
    >
      <SettingsGroup className="gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              Ressources de Docker
              {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Odoo et ses bases tournent dans Docker : avec trop peu de mémoire, les grosses restaurations et les mises
              à jour complètes ralentissent ou échouent.
            </p>
          </div>
          <Button size="sm" variant="ghost" className="shrink-0" disabled={loading} onClick={() => void load()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualiser
          </Button>
        </div>

        {!report ? (
          <p className="text-sm text-muted-foreground">{error || "Lecture des ressources…"}</p>
        ) : (
          <>
            <div className="divide-y rounded-md border">
              <Line
                label="Cet ordinateur"
                value={`${formatMemory(report.host.memory)} · ${processors(report.host.cpus)}`}
              />
              <Line
                label={report.environment === "macos" ? "Docker Desktop" : "Docker"}
                value={docker?.available ? `${formatMemory(docker.memory)} · ${processors(docker.cpus)}` : "arrêté"}
              />
              {recommended && (
                <Line
                  label="Recommandé"
                  value={`${formatMemory(recommended.memory)} · ${processors(recommended.cpus)} · ${formatMemory(recommended.swap)} de swap`}
                />
              )}
            </div>

            {report.status === "critical" && (
              <Notice tone="danger" icon={TriangleAlert} title="Docker manque de mémoire">
                Avec moins de 3 Go, Odoo et sa base se disputent la mémoire : Odoo peut s’arrêter en pleine restauration
                ou mise à jour.
                {report.can_apply ? " Applique la recommandation ci-dessous." : ""}
              </Notice>
            )}

            {report.environment === "linux" && (
              <p className="text-sm text-muted-foreground">
                Sous Linux, Docker utilise directement toute la mémoire et tous les processeurs de l’ordinateur : rien à
                régler.
              </p>
            )}

            {report.can_apply && report.status !== "ok" && (
              <div className="flex flex-col gap-2 rounded-md border bg-muted/35 p-3 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  Docker Desktop redémarre pour prendre les nouveaux réglages : les projets démarrés s’arrêtent, tu
                  pourras les redémarrer ensuite.
                </p>
                <ConfirmButton
                  label={applying ? "Réglage en cours…" : "Appliquer la recommandation"}
                  confirmLabel="Confirmer : Docker redémarre"
                  disabled={Boolean(applying) || !docker?.available}
                  icon={applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
                  onConfirm={() => void createJob("apply_docker_resources")}
                />
              </div>
            )}

            {report.wslconfig && report.status !== "ok" && (
              <div className="grid gap-2 rounded-md border bg-muted/35 p-3">
                <p className="text-xs text-muted-foreground">
                  Sous Windows, Docker reçoit la mémoire de WSL. Crée ou complète le fichier{" "}
                  <span className="font-mono">.wslconfig</span> de ton dossier utilisateur Windows avec ces lignes, puis
                  redémarre l’ordinateur.
                </p>
                <pre className="overflow-x-auto rounded border bg-background p-2 font-mono text-xs">
                  {report.wslconfig}
                </pre>
                <Button size="sm" variant="outline" className="justify-self-start" onClick={() => void copyWslConfig()}>
                  <Copy className="h-4 w-4" />
                  Copier
                </Button>
              </div>
            )}
          </>
        )}
      </SettingsGroup>

      <SettingsGroup className="gap-3">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={settingsDraft.tune_postgres ?? true}
            onCheckedChange={(checked) => setSettingsDraft({ ...settingsDraft, tune_postgres: checked === true })}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-medium">
              <Database className="h-4 w-4 text-muted-foreground" />
              Optimiser les bases PostgreSQL des projets
            </span>
            <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
              Au démarrage de chaque projet, sa base reçoit des réglages adaptés à la mémoire de Docker : restaurations,
              mises à jour et pages plus rapides. Décoché, les réglages d’origine sont rétablis au prochain démarrage.
            </span>
          </span>
        </label>
        {report?.postgres && (settingsDraft.tune_postgres ?? true) && (
          <p className="text-xs text-muted-foreground">
            Réglages appliqués au démarrage : cache {report.postgres.shared_buffers.replace("MB", " Mo")}, construction
            des index {report.postgres.maintenance_work_mem.replace("MB", " Mo")}, requêtes{" "}
            {report.postgres.work_mem.replace("MB", " Mo")}.
          </p>
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}
