"use client";

import { ShieldCheck } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type NeutralizeDatabaseDialogProps = {
  canUseDb: boolean;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedDb: string;
  selectedProject: Project | undefined;
};

export function NeutralizeDatabaseDialog({
  canUseDb,
  createJob,
  loading,
  onOpenChange,
  open,
  selectedDb,
  selectedProject,
}: NeutralizeDatabaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neutraliser {selectedDb || "la base"}</DialogTitle>
          <DialogDescription>
            Odoo sera arrêté brièvement. Tous les crons métier, dont le contrôle d’abonnement, ainsi que les serveurs de
            messagerie entrants et sortants seront désactivés. Sur les versions récentes, Odoo efface aussi les
            identifiants SMTP. Cette opération n’est pas réversible automatiquement.
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
              const job = await createJob("neutralize_database", {
                project: selectedProject?.name,
                db: selectedDb,
              });
              if (job) onOpenChange(false);
            }}
          >
            <ShieldCheck className="h-4 w-4" />
            Confirmer la neutralisation
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
