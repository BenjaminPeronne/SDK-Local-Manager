"use client";

import { useMemo } from "react";
import { AlertTriangle, CloudDownload, ExternalLink, Play, RefreshCcw } from "lucide-react";
import { offlineDockerGuide } from "@/lib/projects";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type ApiUnavailableNoticeProps = {
  desktopRuntime: boolean;
  loadSettings: () => Promise<void>;
  openUrl: (url?: string) => Promise<void>;
  refreshOverview: () => Promise<void>;
  refreshSystemStatus: () => Promise<void>;
  requestDockerStart: () => Promise<void>;
};

export function ApiUnavailableNotice({
  desktopRuntime,
  loadSettings,
  openUrl,
  refreshOverview,
  refreshSystemStatus,
  requestDockerStart,
}: ApiUnavailableNoticeProps) {
  const fallbackDockerGuide = useMemo(() => offlineDockerGuide(), []);

  return (
    <Notice
      tone="danger"
      icon={AlertTriangle}
      title="Service local indisponible"
      actions={
        <>
          <Button
            className="w-full sm:w-auto"
            size="sm"
            onClick={() => Promise.all([refreshOverview(), refreshSystemStatus(), loadSettings()])}
          >
            <RefreshCcw className="h-4 w-4" />
            Réessayer
          </Button>
          <Button
            className="w-full sm:w-auto"
            size="sm"
            variant="outline"
            onClick={() => openUrl(fallbackDockerGuide.download_url)}
          >
            <CloudDownload className="h-4 w-4" />
            Télécharger Docker
          </Button>
          <Button
            className="w-full sm:w-auto"
            size="sm"
            variant="outline"
            onClick={() => openUrl(fallbackDockerGuide.install_url)}
          >
            <ExternalLink className="h-4 w-4" />
            Guide Docker
          </Button>
          <Button
            className="w-full sm:w-auto"
            size="sm"
            variant="outline"
            disabled={!desktopRuntime}
            onClick={requestDockerStart}
          >
            <Play className="h-4 w-4" />
            Ouvrir Docker
          </Button>
        </>
      }
    >
      L’application n’arrive pas à joindre son API locale. Attends quelques secondes puis actualise. Si Docker n’est pas
      encore installé, installe Docker Desktop avant de lancer les projets Odoo.
      <div className="mt-3 rounded-md border border-red-200 bg-white/70 p-3 text-red-950 dark:border-red-800 dark:bg-red-950/55 dark:text-red-50">
        <div className="font-medium">{fallbackDockerGuide.title}</div>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5">
          {fallbackDockerGuide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </Notice>
  );
}
