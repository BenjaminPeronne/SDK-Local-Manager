"use client";

import { ShieldCheck } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimplifiedNeutralizationNotice } from "@/components/databases/simplified-neutralization-notice";

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
            Transforme la base en base de test : elle n’enverra plus d’e-mails à personne et ne lancera plus de tâches
            automatiques. Les e-mails restent visibles dans Mailpit. Odoo redémarre quelques instants. Ce changement ne
            peut pas être annulé.
          </DialogDescription>
        </DialogHeader>
        <SimplifiedNeutralizationNotice odooVersion={selectedProject?.odoo_version} />
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
