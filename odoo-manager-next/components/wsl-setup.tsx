"use client";

import { CheckCircle2, CircuitBoard, FileText, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { desktopBridge, type WslPrepareStep } from "@/lib/desktop";
import { memoryWarning, prepareProgressPercent, wslSetupError, wslSetupState, type WslStatus } from "@/lib/wsl-setup";

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
  // Temps écoulé au début de l'étape en cours : la barre avance pendant chaque étape.
  const [stepStartedAt, setStepStartedAt] = useState(0);
  const elapsedRef = useRef(0);
  // Étape en cours : un nouvel essai garde la même étape, la barre ne repart pas en arrière.
  const stepRef = useRef("");
  // Une préparation déjà lancée au démarrage n'est rejointe qu'une fois par ouverture.
  const joinedRef = useRef(false);

  // L'installation dure plusieurs minutes : l'écran montre où elle en est.
  useEffect(() => {
    const bridge = desktopBridge();
    if (!open || !bridge?.onWslProgress) return;
    return bridge.onWslProgress((step) => {
      setProgress(step);
      if (step.step !== stepRef.current) {
        stepRef.current = step.step;
        setStepStartedAt(elapsedRef.current);
      }
    });
  }, [open]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    elapsedRef.current = 0;
    setElapsed(0);
    const timer = setInterval(() => {
      elapsedRef.current = Math.round((Date.now() - started) / 1000);
      setElapsed(elapsedRef.current);
    }, 1000);
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
    else joinedRef.current = false;
  }, [open, refresh]);

  const state = wslSetupState(status, applicationVersion);

  const act = useCallback(
    async (joined: WslPrepareStep | null = null) => {
      const bridge = desktopBridge();
      if (!bridge) return;
      setBusy(true);
      setError("");
      setProgress(joined);
      stepRef.current = joined?.step ?? "";
      setStepStartedAt(0);
      try {
        if (state.step === "virtualization-disabled") {
          // Rien à lancer : l'utilisateur a changé le réglage, l'écran relit l'état.
          await refresh();
          return;
        }
        if (state.step === "install-wsl" || state.step === "outdated-wsl") {
          const result = await bridge.wslInstallWsl!();
          setRebootRequired(Boolean(result?.rebootRequired));
          if (!result?.ok && !result?.rebootRequired)
            setError(result?.message || "Windows n'a pas pu activer sa fonction Linux.");
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
    },
    [applicationVersion, onReady, refresh, state.step],
  );

  // La préparation lancée au démarrage tourne peut-être déjà : l'écran affiche son avancement
  // et attend son résultat, au lieu de proposer un bouton qui la relancerait.
  useEffect(() => {
    if (!open || busy || !status?.preparing || joinedRef.current) return;
    joinedRef.current = true;
    void act(status.progress ?? null);
  }, [act, busy, open, status]);

  const lowMemory = memoryWarning(status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          <DialogDescription>{state.detail}</DialogDescription>
        </DialogHeader>

        <div className="divide-y overflow-hidden rounded-md border">
          <SetupRow
            ready={Boolean(status?.wslInstalled)}
            title="Linux dans Windows"
            detail={
              status?.wslInstalled ? `Version ${status.wslVersion}` : "Sera activé par Windows, avec une autorisation."
            }
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
            Windows doit redémarrer pour terminer l’activation de sa fonction Linux. La préparation reprendra au
            prochain lancement.
          </p>
        )}
        {error && (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
            {desktopBridge()?.openLogFolder && (
              <Button variant="outline" size="sm" onClick={() => void desktopBridge()?.openLogFolder?.()}>
                <FileText className="h-4 w-4" />
                Ouvrir le journal
              </Button>
            )}
          </div>
        )}
        {busy && <PrepareProgress progress={progress} elapsed={elapsed} stepElapsed={elapsed - stepStartedAt} />}
        {!busy && state.step === "install-environment" && lowMemory && (
          <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {lowMemory}
          </p>
        )}
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
            <Button onClick={() => void act()} disabled={busy}>
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
 * Avancement de la préparation : une seule barre, en pourcentage, et le temps écoulé.
 *
 * `wsl --import` ne publie aucun avancement : le pourcentage s'appuie sur la durée habituelle
 * de chaque étape, avance pendant qu'elle tourne et ne recule jamais.
 */
function PrepareProgress({
  progress,
  elapsed,
  stepElapsed,
}: {
  progress: WslPrepareStep | null;
  elapsed: number;
  stepElapsed: number;
}) {
  const percent = prepareProgressPercent(progress, stepElapsed);
  const label = progress ? progress.label : "Vérification de l’environnement…";

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{percent} %</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-1000 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Temps écoulé {formatElapsed(elapsed)}. La préparation peut durer plusieurs minutes ; l’application reste
        utilisable ensuite sans rien réinstaller.
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
