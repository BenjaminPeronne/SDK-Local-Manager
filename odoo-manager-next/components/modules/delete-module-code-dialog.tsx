"use client";

import type { Dispatch, SetStateAction } from "react";
import { PackageX } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type DeleteModuleCodeDialogProps = {
  canUseDb: boolean;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  deleteCodeUninstallFirst: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pendingDeleteCodeModules: string[];
  refreshModules: () => Promise<void>;
  schedule: (callback: () => void | Promise<void>, delay: number) => void;
  selectedDb: string;
  selectedProject: Project | undefined;
  setDeleteCodeUninstallFirst: Dispatch<SetStateAction<boolean>>;
  setPendingDeleteCodeModules: Dispatch<SetStateAction<string[]>>;
  setSelectedModules: Dispatch<SetStateAction<Set<string>>>;
};

export function DeleteModuleCodeDialog({ canUseDb, createJob, deleteCodeUninstallFirst, loading, onOpenChange, open, pendingDeleteCodeModules, refreshModules, schedule, selectedDb, selectedProject, setDeleteCodeUninstallFirst, setPendingDeleteCodeModules, setSelectedModules }: DeleteModuleCodeDialogProps) {
  async function confirmDeleteCode() {
    if (!selectedProject || !pendingDeleteCodeModules.length) return;
    const job = await createJob("delete_module_code", {
      project: selectedProject.name,
      db: deleteCodeUninstallFirst ? selectedDb : "",
      modules: pendingDeleteCodeModules.join(","),
      uninstall_first: deleteCodeUninstallFirst,
    });
    if (job) {
      onOpenChange(false);
      setPendingDeleteCodeModules([]);
      setSelectedModules(new Set());
      schedule(refreshModules, 2500);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer les modules du projet</DialogTitle>
          <DialogDescription>
            Cette action retire les modules de `odoo/addons` et supprime le dossier géré dans `odoo/addons-store`.
            Les anciens imports encore liés depuis `.odoo_manager_imports` restent aussi nettoyés.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {pendingDeleteCodeModules.map((name) => (
            <div key={name}>{name}</div>
          ))}
        </div>
        <label className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <Checkbox
            className="mt-1"
            checked={deleteCodeUninstallFirst}
            disabled={!canUseDb}
            onCheckedChange={(checked) => setDeleteCodeUninstallFirst(checked === true)}
          />
          <span>
            <span className="block font-medium">Désinstaller de la base avant suppression</span>
            <span className="block text-xs text-muted-foreground">
              Recommandé si la base sélectionnée contient encore le module installé.
            </span>
          </span>
        </label>
        <Button variant="destructive" disabled={!pendingDeleteCodeModules.length || loading} onClick={confirmDeleteCode}>
          <PackageX className="h-4 w-4" />
          Confirmer la suppression du projet
        </Button>
      </DialogContent>
    </Dialog>
  );
}
