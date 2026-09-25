"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SimplifiedNeutralizationNotice } from "@/components/databases/simplified-neutralization-notice";

export type DuplicateDatabasePayload = { newName: string; masterPwd: string; neutralize: boolean };

export function DuplicateDatabaseDialog({
  open,
  onOpenChange,
  project,
  database,
  existingDatabases,
  disabled,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  database: string;
  existingDatabases: string[];
  disabled: boolean;
  onSubmit: (payload: DuplicateDatabasePayload) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dupliquer {database || "la base"}</DialogTitle>
          <DialogDescription>
            {project ? `Projet : ${project.name}. ` : ""}
            Odoo copie la base PostgreSQL et son filestore, comme le bouton « Duplicate » du gestionnaire de bases. Les
            connexions ouvertes sur la base d’origine sont fermées pendant la copie.
          </DialogDescription>
        </DialogHeader>
        <DuplicateDatabaseForm
          project={project}
          database={database}
          existingDatabases={existingDatabases}
          disabled={disabled}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Monté à chaque ouverture (Radix démonte le contenu fermé) : le nom proposé suit la base sélectionnée. */
function DuplicateDatabaseForm({
  project,
  database,
  existingDatabases,
  disabled,
  onCancel,
  onSubmit,
}: {
  project?: Project;
  database: string;
  existingDatabases: string[];
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (payload: DuplicateDatabasePayload) => Promise<void>;
}) {
  const [newName, setNewName] = useState(database ? `${database}_copie` : "");
  const [masterPwd, setMasterPwd] = useState("odoo");
  const [neutralize, setNeutralize] = useState(true);

  const trimmedName = newName.trim();
  const nameTaken = existingDatabases.includes(trimmedName);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Nom de la nouvelle base
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="client_recette"
            autoComplete="off"
            aria-invalid={nameTaken}
          />
          {nameTaken && <span className="text-xs font-normal text-destructive">Cette base existe déjà.</span>}
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Master password
          <Input value={masterPwd} onChange={(event) => setMasterPwd(event.target.value)} type="password" />
        </label>
      </div>

      <label className="flex items-start gap-3 rounded-md border bg-muted/35 p-3 text-sm">
        <Checkbox
          className="mt-0.5"
          checked={neutralize}
          onCheckedChange={(checked) => setNeutralize(checked === true)}
        />
        <span>
          <span className="block font-medium">Neutraliser la copie</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Recommandé : désactive notamment les envois d’e-mails et les actions externes sur la nouvelle base. La base
            d’origine n’est pas modifiée.
          </span>
        </span>
      </label>

      {neutralize && <SimplifiedNeutralizationNotice odooVersion={project?.odoo_version} />}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button
          disabled={disabled || !database || !trimmedName || trimmedName === database || nameTaken || !masterPwd}
          onClick={() => onSubmit({ newName: trimmedName, masterPwd, neutralize })}
        >
          <Copy className="h-4 w-4" />
          Dupliquer la base
        </Button>
      </div>
    </>
  );
}
