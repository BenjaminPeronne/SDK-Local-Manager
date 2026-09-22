"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function DropDatabaseDialog({
  open,
  onOpenChange,
  project,
  database,
  disabled,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  database: string;
  disabled: boolean;
  onSubmit: (masterPwd: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState("");
  const [masterPwd, setMasterPwd] = useState("odoo");

  useEffect(() => {
    if (!open) setConfirm("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer {database || "la base"}</DialogTitle>
          <DialogDescription>
            {project ? `Projet : ${project.name}. ` : ""}
            La base PostgreSQL et son filestore seront supprimés définitivement via Odoo. Saisis le nom de la base pour
            confirmer.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/45 dark:text-red-100">
          Cette opération est irréversible. Pense à sauvegarder la base avant si nécessaire.
        </div>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Nom de la base
            <Input
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder={database}
              autoComplete="off"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Master password
            <Input value={masterPwd} onChange={(event) => setMasterPwd(event.target.value)} type="password" />
          </label>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            disabled={disabled || !database || confirm !== database || !masterPwd}
            onClick={() => onSubmit(masterPwd)}
          >
            <Trash2 className="h-4 w-4" />
            Supprimer définitivement
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
