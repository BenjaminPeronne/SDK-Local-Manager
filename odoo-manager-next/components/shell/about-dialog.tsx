"use client";

import { Copy, Heart } from "lucide-react";
import type { StaticImageData } from "next/image";
import type { ManagerSettings, Toast } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REFINED_LABEL } from "@/components/common/refined-layout";

const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD || "";

const APP_COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT || "";

type AboutDialogProps = {
  appVersion: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pushToast: (kind: Toast["kind"], message: string) => void;
  selectedAppIcon: StaticImageData;
  settings: ManagerSettings | null;
};

export function AboutDialog({ appVersion, onOpenChange, open, pushToast, selectedAppIcon, settings }: AboutDialogProps) {
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
                  const details = [`Build ${APP_BUILD || "local"}`, APP_COMMIT && `commit ${APP_COMMIT}`].filter(Boolean).join(", ");
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
                  <dd className="mt-1 truncate font-mono text-[13px]" title={APP_COMMIT}>{APP_COMMIT}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="rounded-md border p-4">
            <div className="text-sm font-semibold">À propos du créateur</div>
            <div className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
              <Heart className="mt-0.5 h-4 w-4 shrink-0 fill-current text-red-500" aria-hidden="true" />
              <p>Fait avec amour par Aymerick Benjamin LAURETTA-PERONNE</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
