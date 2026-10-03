"use client";

import { CalendarClock } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type FixExpiredDatabaseDialogProps = {
  canUseDb: boolean;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedDb: string;
  selectedProject: Project | undefined;
};

export function FixExpiredDatabaseDialog({
  canUseDb,
  createJob,
  loading,
  onOpenChange,
  open,
  selectedDb,
  selectedProject,
}: FixExpiredDatabaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corriger l’expiration de {selectedDb || "la base"}</DialogTitle>
          <DialogDescription>
            Repousse la date d’expiration d’un an et empêche la base de contacter Odoo, ce qui remettrait l’ancienne
            date. Le message « Cette base a expiré » disparaît au prochain chargement de la page. Odoo sera arrêté
            brièvement. À relancer si la base expire à nouveau.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
          À utiliser uniquement sur une copie locale ou une base de test, jamais sur la production.
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={!selectedProject || !canUseDb || loading}
            onClick={async () => {
              const job = await createJob("fix_expired_database", {
                project: selectedProject?.name,
                db: selectedDb,
              });
              if (job) onOpenChange(false);
            }}
          >
            <CalendarClock className="h-4 w-4" />
            Corriger la base
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
