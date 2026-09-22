"use client";

import type { Dispatch, SetStateAction } from "react";
import { Trash2 } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type UninstallModulesDialogProps = {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pendingUninstallModules: string[];
  refreshModules: () => Promise<void>;
  schedule: (callback: () => void | Promise<void>, delay: number) => void;
  selectedDb: string;
  selectedProject: Project | undefined;
  setPendingUninstallModules: Dispatch<SetStateAction<string[]>>;
  setSelectedModules: Dispatch<SetStateAction<Set<string>>>;
};

export function UninstallModulesDialog({ createJob, loading, onOpenChange, open, pendingUninstallModules, refreshModules, schedule, selectedDb, selectedProject, setPendingUninstallModules, setSelectedModules }: UninstallModulesDialogProps) {
  async function confirmUninstall() {
    if (!selectedProject || !selectedDb || !pendingUninstallModules.length) return;
    const job = await createJob("uninstall_module", {
      project: selectedProject.name,
      db: selectedDb,
      modules: pendingUninstallModules.join(","),
    });
    if (job) {
      onOpenChange(false);
      setPendingUninstallModules([]);
      setSelectedModules(new Set());
      schedule(refreshModules, 2500);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Désinstaller les modules</DialogTitle>
          <DialogDescription>
            Cette action désinstalle les modules de la base {selectedDb || "sélectionnée"}. Les dossiers addons et les liens symboliques ne seront pas
            supprimés.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {pendingUninstallModules.map((name) => (
            <div key={name}>{name}</div>
          ))}
        </div>
        <Button variant="destructive" disabled={!pendingUninstallModules.length || loading} onClick={confirmUninstall}>
          <Trash2 className="h-4 w-4" />
          Confirmer la désinstallation
        </Button>
      </DialogContent>
    </Dialog>
  );
}
