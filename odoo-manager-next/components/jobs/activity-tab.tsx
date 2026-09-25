"use client";

import { type Dispatch, type RefObject, type SetStateAction } from "react";
import { Activity, AlertTriangle, CheckCircle2, Copy, Logs, Square, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { statusLabel, statusVariant } from "@/lib/format";
import { isJobActive, isJobUnfinished, jobStopUnavailableReason } from "@/lib/jobs";
import { formatDiagnostics } from "@/lib/projects";
import type { ExternalLogView, Job, Project, ProjectDiagnostics, Toast } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { REFINED_FOCUS_RING, RefinedPanel, RefinedSectionHeader } from "@/components/common/refined-layout";
import { JobCancelState, JobProgressPanel, JobStopButton } from "@/components/jobs/job-controls";
import { JobOutputPre, OdooLogsModeBar } from "@/components/jobs/job-output";

const LOG_DESCRIPTION_MAX_LENGTH = 240;

type ActivityTabProps = {
  enableLogAutoFollow: () => void;
  logDescriptionExpanded: boolean;
  logOutputRef: RefObject<HTMLPreElement | null>;
  onLogOutputScroll: () => void;
  onShowLogs: (raw?: boolean) => void;
  outputContent: string;
  projectJobs: Job[];
  pushToast: (kind: Toast["kind"], message: string) => void;
  rawOutputVisible: boolean;
  refinedInterface: boolean;
  refreshJobs: (detailJobId?: number | null) => Promise<void>;
  scopedExternalLogView: ExternalLogView | null;
  selectedJob: Job;
  selectedJobId: number | null;
  selectedProject: Project | undefined;
  selectedProjectReady: boolean;
  selectJob: (jobId: number) => void;
  setExternalLogView: Dispatch<SetStateAction<ExternalLogView | null>>;
  setJobToCancelId: Dispatch<SetStateAction<number | null>>;
  setLogDescriptionExpanded: Dispatch<SetStateAction<boolean>>;
  setRawOutputVisible: Dispatch<SetStateAction<boolean>>;
  setSelectedJobId: Dispatch<SetStateAction<number | null>>;
  stopLiveLogStream: () => void;
};

export function ActivityTab({
  enableLogAutoFollow,
  logDescriptionExpanded,
  logOutputRef,
  onLogOutputScroll,
  onShowLogs,
  outputContent,
  projectJobs,
  pushToast,
  rawOutputVisible,
  refinedInterface,
  refreshJobs,
  scopedExternalLogView,
  selectJob,
  selectedJob,
  selectedJobId,
  selectedProject,
  selectedProjectReady,
  setExternalLogView,
  setJobToCancelId,
  setLogDescriptionExpanded,
  setRawOutputVisible,
  setSelectedJobId,
  stopLiveLogStream,
}: ActivityTabProps) {
  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(outputContent);
      pushToast("success", "Sortie copiée.");
    } catch {
      pushToast("error", "Impossible de copier la sortie.");
    }
  }
  async function showDiagnostics() {
    if (!selectedProject) return;
    stopLiveLogStream();
    try {
      const payload = await api<ProjectDiagnostics>(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/diagnostics`,
      );
      setExternalLogView({
        title: `Diagnostic - ${selectedProject.name}`,
        content: formatDiagnostics(payload),
        project: selectedProject.name,
      });
      enableLogAutoFollow();
      pushToast("info", "Diagnostic projet chargé.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Diagnostic indisponible.");
    }
  }
  async function clearJobs() {
    stopLiveLogStream();
    try {
      await api<{ ok: boolean }>("/api/jobs", { method: "DELETE" });
      setSelectedJobId(null);
      setExternalLogView(null);
      await refreshJobs();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Suppression de l'historique impossible.");
    }
  }
  async function deleteJob(jobId: number) {
    try {
      await api<{ ok: boolean }>(`/api/jobs/${jobId}`, { method: "DELETE" });
      if (selectedJobId === jobId) {
        stopLiveLogStream();
        setSelectedJobId(null);
        setExternalLogView(null);
      }
      await refreshJobs();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Suppression de l'entrée impossible.");
    }
  }
  const outputTitle = scopedExternalLogView?.title || selectedJob?.title || "Aucune action sélectionnée";
  const outputProgress =
    !scopedExternalLogView && selectedJob && isJobActive(selectedJob) ? selectedJob.progress : null;
  const outputProgressPercent =
    outputProgress &&
    typeof outputProgress.current === "number" &&
    typeof outputProgress.total === "number" &&
    outputProgress.total > 0
      ? Math.max(0, Math.min(100, Math.round((outputProgress.current / outputProgress.total) * 100)))
      : null;
  const outputTitleIsLong = outputTitle.length > LOG_DESCRIPTION_MAX_LENGTH;
  const displayedOutputTitle =
    outputTitleIsLong && !logDescriptionExpanded
      ? `${outputTitle.slice(0, LOG_DESCRIPTION_MAX_LENGTH).trimEnd()}…`
      : outputTitle;
  // En mode affiné, un job terminé affiche d'abord son résultat ; la sortie brute se déplie à la demande.
  const finishedJobSummary =
    refinedInterface && !scopedExternalLogView && selectedJob && !isJobUnfinished(selectedJob) ? selectedJob : null;
  const selectedJobStop =
    !scopedExternalLogView && selectedJob && isJobUnfinished(selectedJob) ? (
      <JobStopButton job={selectedJob} onRequest={setJobToCancelId} />
    ) : null;
  const rawOutputHidden = Boolean(finishedJobSummary) && !rawOutputVisible;
  // Rien à montrer : un terminal vide occuperait la moitié de l'onglet pour dire « Aucune sortie ».
  const outputEmpty = !scopedExternalLogView && !selectedJob;
  const emptyOutputHint = outputEmpty ? (
    <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      Sélectionne une action pour voir sa sortie, ou ouvre les logs Odoo.
    </p>
  ) : null;

  return (
    <TabsContent value="logs">
      {refinedInterface ? (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <RefinedSectionHeader
              title="Activité du projet"
              count={projectJobs.length}
              actions={
                projectJobs.length ? (
                  <Button variant="outline" size="sm" onClick={clearJobs}>
                    <Trash2 className="h-4 w-4" />
                    Effacer
                  </Button>
                ) : undefined
              }
            />
            {projectJobs.length ? (
              <div className="max-h-[min(62vh,680px)] min-w-0 space-y-2 overflow-y-auto pr-1">
                {projectJobs.map((job) => {
                  const jobSelected = !scopedExternalLogView && selectedJob?.id === job.id;
                  return (
                    <div
                      key={job.id}
                      className={cn(
                        "min-w-0 rounded-md border bg-card transition-colors",
                        jobSelected
                          ? "border-primary bg-selected ring-2 ring-primary/35"
                          : "hover:border-primary/35 hover:bg-hover",
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-1">
                        <button
                          type="button"
                          className={cn("min-w-0 flex-1 rounded-md p-3 text-left", REFINED_FOCUS_RING)}
                          aria-pressed={jobSelected}
                          title={job.title}
                          onClick={() => selectJob(job.id)}
                        >
                          <Badge variant={statusVariant(job.status)}>{statusLabel(job.status)}</Badge>
                          <span className="mt-2 line-clamp-2 break-words text-sm font-medium leading-5">
                            {job.title}
                          </span>
                          <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                            {job.started_at}
                          </span>
                          {job.status === "queued" && job.waiting_for && (
                            <span className="mt-1 block break-words text-xs text-muted-foreground">
                              {job.waiting_for}
                            </span>
                          )}
                        </button>
                        {!isJobUnfinished(job) && (
                          <Button
                            className="m-1 h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            variant="ghost"
                            size="icon"
                            title={`Supprimer l'historique ${job.title}`}
                            aria-label={`Supprimer l'historique ${job.title}`}
                            onClick={() => deleteJob(job.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {isJobUnfinished(job) && (
                        <div className="px-3 pb-3">
                          <JobStopButton job={job} className="w-full" onRequest={setJobToCancelId} />
                          {job.status !== "cancelling" && jobStopUnavailableReason(job) && (
                            <p className="mt-1.5 break-words text-xs text-muted-foreground">
                              {jobStopUnavailableReason(job)}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <RefinedPanel className="border-dashed p-6 text-center">
                <Logs className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-3 font-medium">Aucune action enregistrée</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Les prochaines opérations apparaîtront ici avec leur statut.
                </p>
              </RefinedPanel>
            )}
          </div>

          <RefinedPanel>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
              <div className="min-w-[min(100%,18rem)] flex-1">
                <h3 className="break-words text-sm font-semibold">{displayedOutputTitle}</h3>
                {outputTitleIsLong && (
                  <button
                    type="button"
                    className={cn(
                      "mt-1 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline",
                      REFINED_FOCUS_RING,
                    )}
                    aria-expanded={logDescriptionExpanded}
                    onClick={() => setLogDescriptionExpanded((expanded) => !expanded)}
                  >
                    {logDescriptionExpanded ? "Voir moins" : "Voir plus"}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={showDiagnostics} disabled={!selectedProjectReady}>
                  <Activity className="h-4 w-4" />
                  Diagnostic
                </Button>
                <Button variant="outline" size="sm" onClick={() => onShowLogs()} disabled={!selectedProjectReady}>
                  <Logs className="h-4 w-4" />
                  Logs Odoo
                </Button>
                <Button variant="outline" size="sm" onClick={copyOutput}>
                  <Copy className="h-4 w-4" />
                  Copier
                </Button>
              </div>
            </div>
            <div className="min-w-0 p-4">
              {!scopedExternalLogView && selectedJob && <JobCancelState job={selectedJob} action={selectedJobStop} />}
              {!scopedExternalLogView && selectedJob && isJobActive(selectedJob) && (
                <JobProgressPanel
                  label={
                    outputProgress?.label || selectedJob.last_line || selectedJob.lines.at(-1) || "Traitement en cours"
                  }
                  percent={outputProgressPercent}
                  action={selectedJobStop}
                />
              )}
              {finishedJobSummary && (
                <div
                  className={cn(
                    "mb-3 rounded-md border p-4",
                    finishedJobSummary.status === "error"
                      ? "border-destructive/30 bg-destructive/[0.08]"
                      : finishedJobSummary.status === "cancelled"
                        ? "border-amber-500/30 bg-amber-500/[0.08]"
                        : "border-emerald-500/25 bg-emerald-500/[0.08]",
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {finishedJobSummary.status === "error" ? (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                    ) : finishedJobSummary.status === "cancelled" ? (
                      <Square className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                    {finishedJobSummary.status === "error"
                      ? "Opération en erreur"
                      : finishedJobSummary.status === "cancelled"
                        ? "Opération arrêtée"
                        : "Opération réussie"}
                  </div>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {finishedJobSummary.error_message || (
                      <>
                        Terminée le{" "}
                        <span className="tabular-nums">
                          {finishedJobSummary.finished_at || finishedJobSummary.started_at}
                        </span>
                        .
                      </>
                    )}
                  </p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    aria-expanded={rawOutputVisible}
                    onClick={() => setRawOutputVisible((visible) => !visible)}
                  >
                    {rawOutputVisible ? "Masquer la sortie brute" : "Afficher la sortie brute"}
                  </Button>
                </div>
              )}
              <OdooLogsModeBar
                view={scopedExternalLogView}
                onShowFull={() => onShowLogs(true)}
                onShowSummary={() => onShowLogs()}
              />
              {emptyOutputHint}
              <JobOutputPre
                outputRef={logOutputRef}
                content={outputContent}
                hidden={rawOutputHidden || outputEmpty}
                onScroll={onLogOutputScroll}
              />
            </div>
          </RefinedPanel>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle>Historique</CardTitle>
                <CardDescription>Actions du projet sélectionné.</CardDescription>
              </div>
              <Button className="w-full shrink-0 sm:w-auto" variant="outline" size="sm" onClick={clearJobs}>
                <Trash2 className="h-4 w-4" />
                Effacer
              </Button>
            </CardHeader>
            <CardContent className="max-h-[min(62vh,680px)] min-w-0 space-y-3 overflow-y-auto">
              {projectJobs.length ? (
                projectJobs.map((job) => (
                  <div
                    key={job.id}
                    className={cn(
                      "group grid h-[172px] min-w-0 grid-rows-[minmax(0,1fr)_36px] gap-2 rounded-md border bg-card p-3 shadow-sm transition-[background-color,border-color,box-shadow] hover:border-primary/40 hover:shadow-md",
                      !scopedExternalLogView &&
                        selectedJob?.id === job.id &&
                        "border-primary bg-selected ring-1 ring-primary/25",
                    )}
                  >
                    <button
                      type="button"
                      className="grid min-h-0 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md p-2 text-left transition-colors hover:bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-primary/[0.12]"
                      aria-pressed={!scopedExternalLogView && selectedJob?.id === job.id}
                      title={job.title}
                      onClick={() => selectJob(job.id)}
                    >
                      <span className="flex h-full min-w-0 flex-col justify-between gap-2">
                        <span className="line-clamp-3 break-words text-sm font-semibold leading-5">{job.title}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">
                          {job.status === "queued" && job.waiting_for ? job.waiting_for : job.started_at}
                        </span>
                      </span>
                      <Badge className="min-w-[74px] shrink-0 justify-self-end" variant={statusVariant(job.status)}>
                        {statusLabel(job.status)}
                      </Badge>
                    </button>
                    {isJobUnfinished(job) ? (
                      <JobStopButton job={job} className="w-full" onRequest={setJobToCancelId} />
                    ) : (
                      <Button
                        className="w-full border-red-300 text-red-700 hover:border-red-400 hover:bg-red-50 hover:text-red-800 active:bg-red-100 focus-visible:ring-red-500 dark:border-red-800 dark:text-red-300 dark:hover:border-red-700 dark:hover:bg-red-950/60 dark:hover:text-red-200 dark:active:bg-red-950"
                        variant="outline"
                        size="sm"
                        title={`Supprimer l'historique ${job.title}`}
                        aria-label={`Supprimer l'historique ${job.title}`}
                        onClick={() => deleteJob(job.id)}
                      >
                        Supprimer
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed p-6 text-center">
                  <Logs className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-3 font-medium">Aucune action enregistrée</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Les prochaines opérations apparaîtront ici avec leur statut.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="min-w-0 gap-3 min-[1900px]:flex-row min-[1900px]:items-start min-[1900px]:justify-between">
              <div className="min-w-0 flex-1">
                <CardTitle>Sortie</CardTitle>
                <CardDescription className="break-words">{displayedOutputTitle}</CardDescription>
                {outputTitleIsLong && (
                  <button
                    type="button"
                    className="mt-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={logDescriptionExpanded}
                    onClick={() => setLogDescriptionExpanded((expanded) => !expanded)}
                  >
                    {logDescriptionExpanded ? "Voir moins" : "Voir plus"}
                  </button>
                )}
              </div>
              <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 min-[1900px]:w-auto min-[1900px]:shrink-0">
                <Button
                  className="w-full justify-start sm:justify-center"
                  variant="outline"
                  size="sm"
                  onClick={showDiagnostics}
                  disabled={!selectedProjectReady}
                >
                  <Activity className="h-4 w-4" />
                  Diagnostic
                </Button>
                <Button
                  className="w-full justify-start sm:justify-center"
                  variant="outline"
                  size="sm"
                  onClick={() => onShowLogs()}
                  disabled={!selectedProjectReady}
                >
                  <Logs className="h-4 w-4" />
                  Logs Odoo
                </Button>
                <Button
                  className="w-full justify-start sm:justify-center"
                  variant="outline"
                  size="sm"
                  onClick={copyOutput}
                >
                  <Copy className="h-4 w-4" />
                  Copier
                </Button>
              </div>
            </CardHeader>
            <CardContent className="min-w-0">
              {!scopedExternalLogView && selectedJob && <JobCancelState job={selectedJob} action={selectedJobStop} />}
              {!scopedExternalLogView && selectedJob && isJobActive(selectedJob) && (
                <JobProgressPanel
                  label={
                    outputProgress?.label || selectedJob.last_line || selectedJob.lines.at(-1) || "Traitement en cours"
                  }
                  percent={outputProgressPercent}
                  action={selectedJobStop}
                />
              )}
              <OdooLogsModeBar
                view={scopedExternalLogView}
                onShowFull={() => onShowLogs(true)}
                onShowSummary={() => onShowLogs()}
              />
              {emptyOutputHint}
              <JobOutputPre
                outputRef={logOutputRef}
                content={outputContent}
                hidden={outputEmpty}
                onScroll={onLogOutputScroll}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </TabsContent>
  );
}
