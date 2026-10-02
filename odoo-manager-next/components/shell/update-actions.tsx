"use client";

import { Loader2 } from "lucide-react";
import type { UpdateInstaller } from "@/hooks/use-update-installer";
import type { AppUpdate } from "@/lib/types";
import { Button } from "@/components/ui/button";

type UpdateActionsProps = {
  update: AppUpdate;
  installer: UpdateInstaller;
  hasRunningJobs: boolean;
  openUrl: (url?: string) => Promise<void>;
};

/**
 * Boutons et avancement d'une mise à jour, communs à l'annonce de la barre latérale et à
 * « À propos ». Dans l'application de bureau, elle se télécharge et s'installe en un clic ;
 * ailleurs, ou si le téléchargement échoue, le lien vers GitLab reste.
 */
export function UpdateActions({ update, installer, hasRunningJobs, openUrl }: UpdateActionsProps) {
  const { automatic, phase, download, install } = installer;

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
    <>
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
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${phase.percent}%` }} />
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
    </>
  );
}
