"use client";

import { CheckCircle2, CircuitBoard, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { desktopBridge, type WslPrepareStep } from "@/lib/desktop";
import { wslSetupError, wslSetupState, type WslStatus } from "@/lib/wsl-setup";

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

/** Écran de préparation du poste : un bouton, aucune commande à taper. */
export function WslSetupDialog({
  open,
  onOpenChange,
  applicationVersion,
  onReady,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationVersion: string;
  onReady?: () => void;
}) {
  const [status, setStatus] = useState<WslStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rebootRequired, setRebootRequired] = useState(false);
  const [progress, setProgress] = useState<WslPrepareStep | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // L'installation dure plusieurs minutes : l'écran dit à quelle étape elle en est.
  useEffect(() => {
    const bridge = desktopBridge();
    if (!open || !bridge?.onWslProgress) return;
    return bridge.onWslProgress(setProgress);
  }, [open]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const refresh = useCallback(async () => {
    const bridge = desktopBridge();
    if (!bridge?.wslStatus) return;
    try {
      setStatus(await bridge.wslStatus());
    } catch (cause) {
      setError(wslSetupError(cause));
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const state = wslSetupState(status, applicationVersion);

  const act = useCallback(async () => {
    const bridge = desktopBridge();
    if (!bridge) return;
    setBusy(true);
    setError("");
    setProgress(null);
    try {
      if (state.step === "install-wsl" || state.step === "outdated-wsl") {
        const result = await bridge.wslInstallWsl!();
        setRebootRequired(Boolean(result?.rebootRequired));
        if (!result?.ok && !result?.rebootRequired) setError(result?.message || "L'activation de WSL a échoué.");
      } else {
        const updated = await bridge.wslPrepare!();
        setStatus(updated);
        if (updated?.distributionInstalled && updated.release === applicationVersion) onReady?.();
      }
      await refresh();
    } catch (cause) {
      setError(wslSetupError(cause));
    } finally {
      setBusy(false);
    }
  }, [applicationVersion, onReady, refresh, state.step]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl space-y-5">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          <DialogDescription>{state.detail}</DialogDescription>
        </DialogHeader>

        <div className="divide-y overflow-hidden rounded-md border">
          <SetupRow
            ready={Boolean(status?.wslInstalled)}
            title="WSL"
            detail={status?.wslInstalled ? `Version ${status.wslVersion}` : "Sera activé par Windows, avec une autorisation."}
          />
          <SetupRow
            ready={Boolean(status?.distributionInstalled)}
            title="Environnement Linux"
            detail={
              status?.distributionInstalled
                ? `${status.distribution} · version ${status.release || "inconnue"}`
                : "Docker, Git et le gestionnaire, installés en une fois."
            }
          />
        </div>

        {rebootRequired && (
          <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Windows doit redémarrer pour terminer l’activation de WSL. La préparation reprendra au prochain lancement.
          </p>
        )}
        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
        {busy && <PrepareProgress progress={progress} elapsed={elapsed} />}
        {!busy && state.step === "install-environment" && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            L’installation dure quelques minutes. Tes projets déjà présents sur ce poste ne sont pas modifiés.
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Plus tard
          </Button>
          {state.actionLabel && (
            <Button onClick={act} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircuitBoard className="h-4 w-4" />}
              {busy ? "Préparation…" : state.actionLabel}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Avancement de la préparation : étapes franchies, étape en cours, temps écoulé.
 *
 * `wsl --import` ne publie aucun avancement et les étapes n'ont pas la même durée : la
 * barre montre ce qui est terminé, et l'étape en cours est signalée par une zone animée
 * plutôt que par un pourcentage qui n'aurait aucun fondement.
 */
function PrepareProgress({ progress, elapsed }: { progress: WslPrepareStep | null; elapsed: number }) {
  const total = progress?.total ?? 0;
  const done = progress ? (progress.step === "done" ? progress.total : progress.index - 1) : 0;
  const completed = total > 0 ? (done / total) * 100 : 0;
  const running = total > 0 && progress?.step !== "done" ? 100 / total : 0;

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {progress ? progress.label : "Vérification de l’environnement…"}
        </span>
        {progress && progress.step !== "done" && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            Étape {progress.index} sur {progress.total}
          </span>
        )}
      </div>
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={progress ? progress.label : "Préparation du poste"}
        aria-valuemin={0}
        aria-valuemax={total || undefined}
        aria-valuenow={total ? done : undefined}
      >
        <div className="h-full bg-emerald-500 transition-[width] duration-500 ease-out" style={{ width: `${completed}%` }} />
        {running > 0 && <div className="h-full animate-pulse bg-emerald-500/50" style={{ width: `${running}%` }} />}
      </div>
      <p className="text-xs text-muted-foreground">
        Temps écoulé {formatElapsed(elapsed)}. Cette étape peut durer plusieurs minutes ; l’application reste utilisable ensuite sans rien réinstaller.
      </p>
    </div>
  );
}

function SetupRow({ ready, title, detail }: { ready: boolean; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      {ready ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <CircuitBoard className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="truncate text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
