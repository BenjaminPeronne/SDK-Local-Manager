"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { desktopBridge, desktopErrorMessage, type UpdateSupport } from "@/lib/desktop";
import type { AppUpdate } from "@/lib/types";
import { Button } from "@/components/ui/button";

type Phase =
  | { name: "idle" }
  | { name: "downloading"; percent: number }
  | { name: "ready"; mode: "restart" | "installer"; hint: string }
  | { name: "restarting" }
  | { name: "opened"; hint: string }
  | { name: "failed"; message: string };

type UpdateBannerProps = {
  update: AppUpdate;
  hasRunningJobs: boolean;
  onDismiss: () => void;
  openUrl: (url?: string) => Promise<void>;
};

/**
 * Annonce d'une nouvelle version. Dans l'application de bureau, elle se télécharge et
 * s'installe en un clic ; ailleurs, ou si le téléchargement échoue, le lien vers GitLab reste.
 */
export function UpdateBanner({ update, hasRunningJobs, onDismiss, openUrl }: UpdateBannerProps) {
  const [support, setSupport] = useState<UpdateSupport | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.updateSupport) return;
    let cancelled = false;
    bridge
      .updateSupport()
      .then((value) => {
        if (!cancelled) setSupport(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const automatic = Boolean(update.tag) && support !== null && support.mode !== "none";
  const busy = phase.name === "downloading" || phase.name === "ready" || phase.name === "restarting";

  async function download() {
    const bridge = desktopBridge();
    if (!bridge?.downloadUpdate) return;
    setPhase({ name: "downloading", percent: 0 });
    const unsubscribe = bridge.onUpdateProgress?.((progress) => {
      const percent = progress.total > 0 ? Math.min(100, Math.floor((progress.received * 100) / progress.total)) : 0;
      // Un avancement arrivé après la fin du téléchargement ne doit pas le faire reprendre.
      setPhase((current) => (current.name === "downloading" ? { name: "downloading", percent } : current));
    });
    try {
      const result = await bridge.downloadUpdate(update.tag);
      setPhase(
        result.mode === "none"
          ? { name: "failed", message: "La mise à jour automatique n'est pas possible pour cette installation." }
          : { name: "ready", mode: result.mode, hint: result.hint },
      );
    } catch (error) {
      setPhase({ name: "failed", message: desktopErrorMessage(error, "Le téléchargement a échoué.") });
    } finally {
      unsubscribe?.();
    }
  }

  async function install() {
    const bridge = desktopBridge();
    if (!bridge?.installUpdate || phase.name !== "ready") return;
    const { mode, hint } = phase;
    if (mode === "restart") setPhase({ name: "restarting" });
    try {
      await bridge.installUpdate();
      // En mode redémarrage, l'application se ferme avant d'arriver ici.
      if (mode === "installer") setPhase({ name: "opened", hint });
    } catch (error) {
      setPhase({ name: "failed", message: desktopErrorMessage(error, "L'installation n'a pas pu démarrer.") });
    }
  }

  const gitlabLink = (
    <button
      type="button"
      className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
      onClick={() => void openUrl(update.url)}
    >
      Télécharger depuis GitLab
    </button>
  );

  return (
    <div className="col-span-2 flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 p-2.5 text-sm lg:col-span-1">
      <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Version {update.latest} disponible</div>
        <div className="text-xs text-muted-foreground">Version installée : {update.current}</div>

        {phase.name === "idle" &&
          (automatic ? (
            <Button className="mt-2 w-full" size="sm" onClick={() => void download()}>
              Mettre à jour
            </Button>
          ) : (
            gitlabLink
          ))}

        {phase.name === "downloading" && (
          <div className="mt-2 space-y-1">
            <div className="text-xs text-muted-foreground">Téléchargement… {phase.percent} %</div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-primary/20"
              role="progressbar"
              aria-label="Téléchargement de la nouvelle version"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={phase.percent}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${phase.percent}%` }}
              />
            </div>
          </div>
        )}

        {phase.name === "ready" && phase.mode === "restart" && (
          <div className="mt-2 space-y-1.5">
            <div className="text-xs text-muted-foreground">Prête à installer : l&apos;application va redémarrer.</div>
            <Button className="w-full" size="sm" disabled={hasRunningJobs} onClick={() => void install()}>
              Redémarrer maintenant
            </Button>
            {hasRunningJobs && (
              <div className="text-xs text-muted-foreground">
                Une action est en cours : le redémarrage sera possible à sa fin.
              </div>
            )}
          </div>
        )}

        {phase.name === "ready" && phase.mode === "installer" && (
          <div className="mt-2 space-y-1.5">
            <Button className="w-full" size="sm" onClick={() => void install()}>
              Ouvrir l&apos;installateur
            </Button>
            <div className="text-xs text-muted-foreground">{phase.hint}</div>
          </div>
        )}

        {phase.name === "restarting" && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Redémarrage en cours…
          </div>
        )}

        {phase.name === "opened" && <div className="mt-2 text-xs text-muted-foreground">{phase.hint}</div>}

        {phase.name === "failed" && (
          <div className="mt-2 space-y-1">
            <div className="text-xs text-destructive">{phase.message}</div>
            <div className="flex flex-wrap items-center gap-x-3">
              {automatic && (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => void download()}
                >
                  Réessayer
                </button>
              )}
              {gitlabLink}
            </div>
          </div>
        )}
      </div>
      {!busy && (
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          title="Masquer jusqu'à la prochaine version"
          aria-label="Masquer l'annonce de mise à jour"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
