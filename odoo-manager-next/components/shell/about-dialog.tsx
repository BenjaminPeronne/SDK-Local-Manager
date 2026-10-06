"use client";

import { Copy, Heart, Loader2, RefreshCw } from "lucide-react";
import type { StaticImageData } from "next/image";
import type { UpdateInstaller } from "@/hooks/use-update-installer";
import { formatCheckedAt, updateCheckStatus } from "@/lib/app-update";
import type { AppUpdate, ManagerSettings, Toast } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UpdateActions } from "@/components/shell/update-actions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REFINED_LABEL } from "@/components/common/refined-layout";
import approvedByChouab from "./approved-by-chouab.png";

const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD || "";

const APP_COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT || "";

type AboutDialogProps = {
  appVersion: string;
  hasRunningJobs: boolean;
  onCheckUpdate: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  openUrl: (url?: string) => Promise<void>;
  pushToast: (kind: Toast["kind"], message: string) => void;
  selectedAppIcon: StaticImageData;
  settings: ManagerSettings | null;
  update: AppUpdate | null;
  updateCheckFailure: string;
  updateChecking: boolean;
  updateInstaller: UpdateInstaller;
};

export function AboutDialog({
  appVersion,
  hasRunningJobs,
  onCheckUpdate,
  onOpenChange,
  open,
  openUrl,
  pushToast,
  selectedAppIcon,
  settings,
  update,
  updateCheckFailure,
  updateChecking,
  updateInstaller,
}: AboutDialogProps) {
  const status = updateCheckStatus(update, { checking: updateChecking, failure: updateCheckFailure });
  const checkedAt = formatCheckedAt(update?.checked_at);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>À propos d’SDK Local Manager</DialogTitle>
          <DialogDescription>
            Gestionnaire local pour créer, administrer et maintenir des environnements Odoo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="overflow-hidden rounded-md border">
            <div className="flex min-w-0 items-center gap-3 bg-muted/35 p-4">
              <img
                src={selectedAppIcon.src}
                alt=""
                aria-hidden="true"
                className={cn(
                  "h-12 w-12 shrink-0 object-cover",
                  settings?.interface_icon === "local" ? "rounded-full" : "rounded-[11px]",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">SDK Local Manager</div>
                <div className="mt-0.5 text-sm text-muted-foreground">Application desktop multi-plateforme</div>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="shrink-0"
                title="Copier les informations de version"
                aria-label="Copier les informations de version"
                onClick={async () => {
                  const details = [`Build ${APP_BUILD || "local"}`, APP_COMMIT && `commit ${APP_COMMIT}`]
                    .filter(Boolean)
                    .join(", ");
                  try {
                    await navigator.clipboard.writeText(`SDK Local Manager ${appVersion} (${details})`);
                    pushToast("success", "Informations de version copiées.");
                  } catch {
                    pushToast("error", "Impossible de copier les informations de version.");
                  }
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <dl className={cn("grid divide-x border-t text-sm", APP_COMMIT ? "grid-cols-3" : "grid-cols-2")}>
              <div className="min-w-0 px-4 py-3">
                <dt className={REFINED_LABEL}>Version</dt>
                <dd className="mt-1 font-medium tabular-nums">{appVersion}</dd>
              </div>
              <div className="min-w-0 px-4 py-3">
                <dt className={REFINED_LABEL}>Build</dt>
                <dd className={cn("mt-1 font-medium tabular-nums", !APP_BUILD && "text-muted-foreground")}>
                  {APP_BUILD || "Local"}
                </dd>
              </div>
              {APP_COMMIT && (
                <div className="min-w-0 px-4 py-3">
                  <dt className={REFINED_LABEL}>Commit</dt>
                  <dd className="mt-1 truncate font-mono text-[13px]" title={APP_COMMIT}>
                    {APP_COMMIT}
                  </dd>
                </div>
              )}
            </dl>
          </div>
          <div className="rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Mises à jour</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={updateChecking || updateInstaller.busy}
                onClick={onCheckUpdate}
              >
                {updateChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Rechercher une mise à jour
              </Button>
            </div>
            <p
              className={cn(
                "mt-3 text-sm",
                status.tone === "muted" && "text-muted-foreground",
                status.tone === "success" && "text-emerald-600 dark:text-emerald-400",
                status.tone === "available" && "font-medium",
                status.tone === "error" && "text-destructive",
              )}
              role="status"
            >
              {status.text}
            </p>
            {checkedAt && !updateChecking && (
              <p className="mt-1 text-xs text-muted-foreground">Dernière vérification : {checkedAt}</p>
            )}
            {update?.update_available && !updateChecking && (
              <div className="max-w-xs">
                <UpdateActions
                  update={update}
                  installer={updateInstaller}
                  hasRunningJobs={hasRunningJobs}
                  openUrl={openUrl}
                />
              </div>
            )}
            {status.tone === "error" && update?.url && (
              <button
                type="button"
                className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => void openUrl(update.url)}
              >
                Voir les versions sur GitLab
              </button>
            )}
          </div>
          <div className="rounded-md border p-4">
            <div className="text-sm font-semibold">À propos du créateur</div>
            <div className="mt-3 flex items-center gap-3">
              <img
                src={approvedByChouab.src}
                alt="Sceau « Approuvé par Chouab »"
                width={72}
                height={72}
                className="h-[72px] w-[72px] shrink-0 drop-shadow-md transition-transform duration-300 ease-out hover:-rotate-6 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:transform-none"
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold">Approuvé par Chouab</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Sceau officiel d’approbation</div>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 border-t pt-3 text-sm leading-relaxed text-muted-foreground">
              <Heart className="mt-0.5 h-4 w-4 shrink-0 fill-current text-red-500" aria-hidden="true" />
              <p>Fait avec amour par Aymerick Benjamin LAURETTA-PERONNE</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
