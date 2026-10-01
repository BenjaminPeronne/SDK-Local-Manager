"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Cloud, FolderOpen, HardDrive, Loader2, RotateCcw, ScanSearch, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { isJobActive } from "@/lib/jobs";
import type { DiskUsageReport, Job } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";
import { SettingsGroup, SettingsSection } from "@/components/settings/settings-section";

// Actions de cette section : leur fin relit le rapport, que le backend tient à jour.
const DISK_JOB_TITLES = new Set([
  "Analyser l'espace disque",
  "Vider la corbeille des projets",
  "Restaurer un projet supprimé",
  "Vider un dossier du gestionnaire",
  "Supprimer des images Docker inutilisées",
  "Vider le cache de construction Docker",
]);

const EMPTY_TRASH_ENTRY_BYTES = 5 * 1024 ** 2;
const OFFLOADED_THRESHOLD_BYTES = 50 * 1024 ** 2;

/**
 * Précision sur une entrée de la corbeille : dossiers vidés hors du gestionnaire, ou fichiers
 * qu'iCloud ne garde plus sur ce disque (`du` ne les compte pas, leur taille totale si).
 */
function trashNote(bytes: number, apparentBytes = bytes) {
  if (apparentBytes < EMPTY_TRASH_ENTRY_BYTES) return " · déjà vide, tu peux le supprimer";
  if (apparentBytes - bytes > OFFLOADED_THRESHOLD_BYTES) {
    return ` · ${formatBytes(apparentBytes - bytes)} de plus sont gardés en ligne dans iCloud`;
  }
  return "";
}

/** Deux temps : le premier clic arme le bouton, le second confirme. Désarmé après 5 s. */
function ConfirmButton({
  label,
  confirmLabel,
  disabled,
  onConfirm,
  icon,
}: {
  label: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
  icon?: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Button
      size="sm"
      variant={armed ? "destructive" : "outline"}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          window.clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
        timer.current = window.setTimeout(() => setArmed(false), 5000);
      }}
    >
      {icon ?? <Trash2 className="h-4 w-4" />}
      {armed ? confirmLabel : label}
    </Button>
  );
}

function Row({
  title,
  detail,
  size,
  actions,
}: {
  title: ReactNode;
  detail?: ReactNode;
  size: number;
  actions?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="break-all text-sm font-medium">{title}</div>
        {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="w-20 text-right text-sm tabular-nums">{formatBytes(size)}</span>
        {actions}
      </div>
    </li>
  );
}

function Group({
  icon,
  title,
  description,
  total,
  actions,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  total: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsGroup className="gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {title}
            <span className="font-normal tabular-nums text-muted-foreground">{formatBytes(total)}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {actions}
      </div>
      {children}
    </SettingsGroup>
  );
}

export function DiskUsagePanel({
  createJob,
  jobs,
}: {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  jobs: Job[];
}) {
  const [report, setReport] = useState<DiskUsageReport | null>(null);
  const [error, setError] = useState("");
  const [showAllProjects, setShowAllProjects] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await api<{ report: DiskUsageReport | null }>("/api/disk-usage");
      setReport(payload.report);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lecture de l'espace disque impossible.");
    }
  }, []);

  const diskJobs = useMemo(() => jobs.filter((job) => DISK_JOB_TITLES.has(job.title)), [jobs]);
  const runningJob = diskJobs.find(isJobActive);
  const scanJob = runningJob?.title === "Analyser l'espace disque" ? runningJob : undefined;
  // Relu à l'ouverture, puis à chaque fin d'action de cette section.
  const finishedKey = diskJobs
    .filter((job) => !isJobActive(job))
    .map((job) => job.id)
    .join(",");
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, finishedKey]);

  const busy = Boolean(runningJob);
  const trashTotal = report?.trash.reduce((sum, row) => sum + row.bytes, 0) ?? 0;
  const foldersTotal = report?.folders.reduce((sum, row) => sum + row.bytes, 0) ?? 0;
  const imagesTotal = report?.docker.unused_images.reduce((sum, row) => sum + row.bytes, 0) ?? 0;
  const projectsTotal = report?.projects.reduce((sum, row) => sum + row.bytes, 0) ?? 0;
  const freeable = trashTotal + foldersTotal + imagesTotal + (report?.docker.build_cache_bytes ?? 0);
  const projects = showAllProjects ? report?.projects : report?.projects.slice(0, 8);

  return (
    <SettingsSection
      title="Espace disque"
      description="La place prise par tes projets, et ce que tu peux supprimer sans risque pour libérer de l’espace."
    >
      <SettingsGroup className="gap-3 sm:flex sm:items-center">
        <div className="min-w-0 flex-1">
          {report ? (
            <>
              <div className="text-sm">
                <span className="font-semibold">{formatBytes(freeable)} peuvent être libérés</span>
                <span className="text-muted-foreground"> · tes projets occupent {formatBytes(projectsTotal)}</span>
              </div>
              <div className="mt-0.5 break-all text-xs text-muted-foreground">
                Analyse du {new Date(report.scanned_at * 1000).toLocaleString("fr-FR")} · {report.workspace}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {error || "Clique sur Analyser pour voir la place utilisée. Cela peut prendre quelques minutes."}
            </div>
          )}
          {scanJob?.progress && (
            <div className="mt-1 text-xs text-muted-foreground">
              {scanJob.progress.label}
              {scanJob.progress.total ? ` (${(scanJob.progress.current ?? 0) + 1}/${scanJob.progress.total})` : ""}
            </div>
          )}
        </div>
        <Button disabled={busy} onClick={() => void createJob("scan_disk_usage")}>
          {scanJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
          {scanJob ? "Analyse en cours…" : report ? "Analyser de nouveau" : "Analyser"}
        </Button>
      </SettingsGroup>

      {report?.icloud_synced && (
        <Notice tone="warning" icon={Cloud} title="Tes projets sont enregistrés dans iCloud">
          Tes projets sont dans Documents, qu’iCloud copie en ligne. Ce n’est pas fait pour des bases Odoo : elles
          peuvent s’abîmer. Pour éviter ça, déplace le dossier des projets ailleurs (par exemple dans ton dossier
          personnel), puis indique le nouvel emplacement dans Général.
        </Notice>
      )}

      {report && (
        <>
          <Group
            icon={<Trash2 className="h-4 w-4 text-muted-foreground" />}
            title="Corbeille des projets supprimés"
            description="Les projets que tu as supprimés. Ils sont gardés ici au cas où tu voudrais les récupérer."
            total={trashTotal}
            actions={
              report.trash.length > 1 && (
                <ConfirmButton
                  label="Tout supprimer"
                  confirmLabel={`Confirmer · ${formatBytes(trashTotal)}`}
                  disabled={busy}
                  onConfirm={() =>
                    void createJob("purge_deleted_projects", { names: report.trash.map((row) => row.name) })
                  }
                />
              )
            }
          >
            {report.trash.length ? (
              <ul className="divide-y rounded-md border">
                {report.trash.map((row) => (
                  <Row
                    key={row.name}
                    title={row.project}
                    detail={`Supprimé le ${row.deleted_at}${trashNote(row.bytes, row.apparent_bytes)}`}
                    size={row.bytes}
                    actions={
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void createJob("restore_deleted_project", { name: row.name })}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Restaurer
                        </Button>
                        <ConfirmButton
                          label="Supprimer"
                          confirmLabel="Confirmer"
                          disabled={busy}
                          onConfirm={() => void createJob("purge_deleted_projects", { names: [row.name] })}
                        />
                      </>
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">La corbeille est vide.</p>
            )}
          </Group>

          <Group
            icon={<FolderOpen className="h-4 w-4 text-muted-foreground" />}
            title="Fichiers de travail du gestionnaire"
            description="Anciennes copies et fichiers temporaires gardés par sécurité. Tu peux les supprimer si tout fonctionne."
            total={foldersTotal}
          >
            {report.folders.length ? (
              <ul className="divide-y rounded-md border">
                {report.folders.map((row) => (
                  <Row
                    key={row.key}
                    title={row.label}
                    detail={row.name}
                    size={row.bytes}
                    actions={
                      <ConfirmButton
                        label="Vider"
                        confirmLabel="Confirmer"
                        disabled={busy || row.bytes === 0}
                        onConfirm={() => void createJob("purge_manager_folder", { folder: row.key })}
                      />
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Rien à libérer.</p>
            )}
          </Group>

          <Group
            icon={<Box className="h-4 w-4 text-muted-foreground" />}
            title="Téléchargements inutilisés"
            description="Éléments téléchargés dont plus aucun projet n’a besoin. Ceux de tes projets, même arrêtés, sont toujours gardés."
            total={imagesTotal + report.docker.build_cache_bytes}
            actions={
              report.docker.unused_images.length > 0 && (
                <ConfirmButton
                  label={`Supprimer ${report.docker.unused_images.length} image${report.docker.unused_images.length > 1 ? "s" : ""}`}
                  confirmLabel={`Confirmer · ${formatBytes(imagesTotal)}`}
                  disabled={busy}
                  onConfirm={() =>
                    void createJob("remove_docker_images", {
                      images: report.docker.unused_images.map((image) => image.id),
                    })
                  }
                />
              )
            }
          >
            {!report.docker.available ? (
              <p className="text-sm text-muted-foreground">
                Docker était arrêté pendant l’analyse : lance Docker puis analyse de nouveau.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {report.docker.unused_images.map((image) => (
                  <Row
                    key={`${image.id}-${image.reference}`}
                    title={image.reference === "image orpheline" ? "Élément sans nom" : image.reference}
                    detail={image.reference === "image orpheline" ? "Reste d’une ancienne mise à jour." : undefined}
                    size={image.bytes}
                  />
                ))}
                <Row
                  title="Cache de Docker"
                  detail="Fichiers temporaires gardés par Docker. Ils seront recréés si besoin."
                  size={report.docker.build_cache_bytes}
                  actions={
                    <ConfirmButton
                      label="Vider"
                      confirmLabel="Confirmer"
                      disabled={busy || report.docker.build_cache_bytes === 0}
                      onConfirm={() => void createJob("prune_docker_build_cache")}
                    />
                  }
                />
              </ul>
            )}
          </Group>

          <Group
            icon={<HardDrive className="h-4 w-4 text-muted-foreground" />}
            title="Projets"
            description="La place prise par chaque projet : ses bases de données, ses fichiers joints et son code."
            total={projectsTotal}
          >
            <ul className="divide-y rounded-md border">
              {projects?.map((row) => (
                <Row
                  key={row.name}
                  title={row.name}
                  detail={`Bases ${formatBytes(row.databases_bytes)} · fichiers joints ${formatBytes(row.filestore_bytes)} · code ${formatBytes(row.code_bytes)}`}
                  size={row.bytes}
                />
              ))}
            </ul>
            {report.projects.length > 8 && (
              <button
                type="button"
                className={cn("justify-self-start text-xs font-medium text-primary underline-offset-2 hover:underline")}
                onClick={() => setShowAllProjects((value) => !value)}
              >
                {showAllProjects ? "Afficher les plus gros" : `Afficher les ${report.projects.length} projets`}
              </button>
            )}
          </Group>
        </>
      )}
    </SettingsSection>
  );
}
