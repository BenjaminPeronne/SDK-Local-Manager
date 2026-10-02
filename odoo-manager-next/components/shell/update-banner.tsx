"use client";

import { Download, X } from "lucide-react";
import type { UpdateInstaller } from "@/hooks/use-update-installer";
import type { AppUpdate } from "@/lib/types";
import { UpdateActions } from "@/components/shell/update-actions";

type UpdateBannerProps = {
  update: AppUpdate;
  installer: UpdateInstaller;
  hasRunningJobs: boolean;
  onDismiss: () => void;
  openUrl: (url?: string) => Promise<void>;
};

/** Annonce d'une nouvelle version dans la barre latérale ; masquable jusqu'à la suivante. */
export function UpdateBanner({ update, installer, hasRunningJobs, onDismiss, openUrl }: UpdateBannerProps) {
  return (
    <div className="col-span-2 flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 p-2.5 text-sm lg:col-span-1">
      <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Version {update.latest} disponible</div>
        <div className="text-xs text-muted-foreground">Version installée : {update.current}</div>
        <UpdateActions update={update} installer={installer} hasRunningJobs={hasRunningJobs} openUrl={openUrl} />
      </div>
      {!installer.busy && (
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
