"use client";

import { AlertTriangle, CloudDownload, ExternalLink, Loader2, Play, Settings } from "lucide-react";
import type { DockerSummary } from "@/lib/system-notices";
import type { DockerStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type DockerActionProps = {
  className?: string;
  docker: DockerStatus;
  loading: boolean;
  openUrl: (url?: string) => Promise<void>;
  requestDockerStart: () => Promise<void>;
};

/** Ce qui remet Docker en marche : le télécharger s'il manque, sinon l'ouvrir. */
export function DockerAction({ className, docker, loading, openUrl, requestDockerStart }: DockerActionProps) {
  if (docker.state === "missing" && docker.install_guide?.download_url)
    return (
      <Button className={className} size="sm" onClick={() => openUrl(docker.install_guide?.download_url)}>
        <CloudDownload className="h-4 w-4" />
        Télécharger Docker
      </Button>
    );
  if (!docker.can_start) return null;
  return (
    <Button className={className} size="sm" disabled={loading} onClick={requestDockerStart}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      Ouvrir Docker
    </Button>
  );
}

type DockerNoticeProps = Omit<DockerActionProps, "className"> & {
  openSettingsDialog: () => void;
  summary: DockerSummary;
};

/** Docker arrêté, en cours de démarrage ou absent : une phrase, l'action qui débloque, le guide s'il manque. */
export function DockerNotice({
  docker,
  loading,
  openSettingsDialog,
  openUrl,
  requestDockerStart,
  summary,
}: DockerNoticeProps) {
  if (summary.state === "starting")
    return (
      <Notice tone="neutral" icon={Loader2} iconClassName="animate-spin" title={summary.title}>
        {summary.message}
      </Notice>
    );
  const missing = summary.state === "missing";
  return (
    <Notice
      tone="warning"
      icon={AlertTriangle}
      title={summary.title}
      actions={
        <>
          <DockerAction
            className="w-full sm:w-auto"
            docker={docker}
            loading={loading}
            openUrl={openUrl}
            requestDockerStart={requestDockerStart}
          />
          {missing && docker.install_guide?.install_url && (
            <Button
              className="w-full sm:w-auto"
              size="sm"
              variant="outline"
              onClick={() => openUrl(docker.install_guide?.install_url)}
            >
              <ExternalLink className="h-4 w-4" />
              Guide Docker
            </Button>
          )}
          <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={openSettingsDialog}>
            <Settings className="h-4 w-4" />
            Paramètres
          </Button>
        </>
      }
    >
      <span title={summary.detail || undefined}>{summary.message}</span>
      {missing && docker.install_guide && (
        <div className="mt-3 rounded-md border border-amber-200 bg-white/70 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/55 dark:text-amber-50">
          <div className="font-medium">{docker.install_guide.title}</div>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5">
            {docker.install_guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </Notice>
  );
}
