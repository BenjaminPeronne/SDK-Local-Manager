"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type DeleteProjectDialogProps = {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedProject: Project | undefined;
};

export function DeleteProjectDialog({ createJob, onOpenChange, open, selectedProject }: DeleteProjectDialogProps) {
  const [deleteConfirm, setDeleteConfirm] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer {selectedProject?.name}</DialogTitle>
          <DialogDescription>
            Le projet sera déplacé dans `.odoo_manager_deleted`. Saisis le nom du projet pour confirmer.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={deleteConfirm}
          onChange={(event) => setDeleteConfirm(event.target.value)}
          placeholder={selectedProject?.name}
        />
        <Button
          variant="destructive"
          disabled={!selectedProject || deleteConfirm !== selectedProject.name}
          onClick={async () => {
            await createJob("delete_project", { project: selectedProject?.name });
            setDeleteConfirm("");
            onOpenChange(false);
          }}
        >
          <Trash2 className="h-4 w-4" />
          Supprimer
        </Button>
      </DialogContent>
    </Dialog>
  );
}
