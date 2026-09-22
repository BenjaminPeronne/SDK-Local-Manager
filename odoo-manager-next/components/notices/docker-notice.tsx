"use client";

import { AlertTriangle, CloudDownload, ExternalLink, Loader2, Play, Settings } from "lucide-react";
import type { DockerStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type DockerNoticeProps = {
  loading: boolean;
  openSettingsDialog: () => void;
  openUrl: (url?: string) => Promise<void>;
  requestDockerStart: () => Promise<void>;
  docker: DockerStatus;
};

export function DockerNotice({ loading, openSettingsDialog, openUrl, requestDockerStart, docker }: DockerNoticeProps) {
  return (
    <Notice
      tone="warning"
      icon={AlertTriangle}
      title="Docker n’est pas disponible"
      actions={
        <>
          {docker.state === "missing" && docker.install_guide?.download_url && (
            <Button className="w-full sm:w-auto" size="sm" onClick={() => openUrl(docker.install_guide?.download_url)}>
              <CloudDownload className="h-4 w-4" />
              Télécharger Docker
            </Button>
          )}
          {docker.can_start && (
            <Button className="w-full sm:w-auto" size="sm" disabled={loading} onClick={requestDockerStart}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Ouvrir Docker
            </Button>
          )}
          {docker.install_guide?.install_url && (
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
      {docker.message}
      {docker.state === "missing" && docker.install_guide && (
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
