"use client";

import { AlertTriangle, Loader2, Play, Settings, Square } from "lucide-react";
import { desktopBridge } from "@/lib/desktop";
import type { TraefikStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type TraefikActionProps = {
  className?: string;
  dockerRunning: boolean;
  loading: boolean;
  requestLegacyTraefikStop: () => Promise<void>;
  requestTraefikInstall: () => Promise<void>;
  traefik: TraefikStatus;
};

/** Ce qui rend Traefik disponible : libérer son port, le démarrer ou l'installer. */
export function TraefikAction({
  className,
  dockerRunning,
  loading,
  requestLegacyTraefikStop,
  requestTraefikInstall,
  traefik,
}: TraefikActionProps) {
  if (traefik.state === "port_busy" && desktopBridge()?.stopLegacyTraefik)
    return (
      <Button
        className={className}
        size="sm"
        disabled={loading}
        title="Les projets restés sur l’ancienne installation ne s’ouvriront plus par leur adresse tant qu’il est arrêté."
        onClick={requestLegacyTraefikStop}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
        Arrêter l’ancien Traefik
      </Button>
    );
  return (
    <Button className={className} size="sm" disabled={!dockerRunning || loading} onClick={requestTraefikInstall}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {traefik.installed ? "Démarrer Traefik" : "Installer Traefik"}
    </Button>
  );
}

type TraefikNoticeProps = Omit<TraefikActionProps, "className"> & {
  openSettingsDialog: () => void;
};

/** Affiché seulement quand Docker tourne : arrêté, Docker a déjà son propre bandeau et Traefik repart avec lui. */
export function TraefikNotice({ openSettingsDialog, traefik, ...actionProps }: TraefikNoticeProps) {
  return (
    <Notice
      tone="info"
      icon={AlertTriangle}
      title="Traefik n’est pas prêt"
      actions={
        <>
          <TraefikAction className="w-full sm:w-auto" traefik={traefik} {...actionProps} />
          <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={openSettingsDialog}>
            <Settings className="h-4 w-4" />
            Paramètres
          </Button>
        </>
      }
    >
      {traefik.message}
      {/* Le dossier n'aide que s'il faut le retrouver ou le réparer. */}
      {(!traefik.installed || traefik.state === "invalid") && (
        <div className="mt-1 break-all text-xs opacity-80">Dossier attendu : {traefik.path}</div>
      )}
    </Notice>
  );
}
