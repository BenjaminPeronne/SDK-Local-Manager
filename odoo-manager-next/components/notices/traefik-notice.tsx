"use client";

import { AlertTriangle, Loader2, Play, Settings, Square } from "lucide-react";
import { desktopBridge } from "@/lib/desktop";
import type { TraefikStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type TraefikNoticeProps = {
  loading: boolean;
  openSettingsDialog: () => void;
  requestLegacyTraefikStop: () => Promise<void>;
  requestTraefikInstall: () => Promise<void>;
  traefik: TraefikStatus;
  dockerRunning: boolean;
};

export function TraefikNotice({
  loading,
  openSettingsDialog,
  requestLegacyTraefikStop,
  requestTraefikInstall,
  traefik,
  dockerRunning,
}: TraefikNoticeProps) {
  return (
    <Notice
      tone="info"
      icon={AlertTriangle}
      title="Traefik n’est pas prêt"
      actions={
        <>
          {traefik.state === "port_busy" && desktopBridge()?.stopLegacyTraefik ? (
            <Button
              className="w-full sm:w-auto"
              size="sm"
              disabled={loading}
              title="Les projets restés sous Docker Desktop ne seront plus accessibles par leur adresse tant qu’il est arrêté."
              onClick={requestLegacyTraefikStop}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Arrêter l’ancien Traefik
            </Button>
          ) : (
            <Button
              className="w-full sm:w-auto"
              size="sm"
              disabled={!dockerRunning || loading}
              onClick={requestTraefikInstall}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {traefik.installed ? "Démarrer Traefik" : "Installer Traefik"}
            </Button>
          )}
          <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={openSettingsDialog}>
            <Settings className="h-4 w-4" />
            Paramètres
          </Button>
        </>
      }
    >
      {traefik.message}
      {traefik.requires_docker ? " Docker doit être installé et démarré avant cette étape." : ""}
      <div className="mt-1 break-all text-xs opacity-80">Dossier attendu : {traefik.path}</div>
    </Notice>
  );
}
