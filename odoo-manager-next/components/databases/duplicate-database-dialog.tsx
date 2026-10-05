"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DefaultPasswordInput } from "@/components/common/default-password-input";
import { DEFAULT_MASTER_PASSWORD } from "@/lib/odoo-defaults";
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
            Crée une copie complète de la base, avec ses fichiers joints. Les personnes connectées à la base d’origine
            seront déconnectées pendant la copie.
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
  const [masterPwd, setMasterPwd] = useState(DEFAULT_MASTER_PASSWORD);
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
          <DefaultPasswordInput value={masterPwd} onChange={setMasterPwd} defaultValue={DEFAULT_MASTER_PASSWORD} />
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
            Recommandé : la copie n’enverra pas d’e-mails à de vrais clients. La base d’origine ne change pas.
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
