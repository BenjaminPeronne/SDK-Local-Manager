"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Nom d'une section de la liste des projets : création (avec un projet à y ranger) ou renommage. */
export function ProjectSectionDialog({
  open,
  onOpenChange,
  initialName,
  project,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nom actuel quand on renomme ; vide pour une nouvelle section. */
  initialName: string;
  /** Projet rangé dans la nouvelle section dès sa création. */
  project?: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);
  const renaming = Boolean(initialName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{renaming ? "Renommer la section" : "Nouvelle section"}</DialogTitle>
          <DialogDescription>
            {project
              ? `${project} sera rangé dans cette section.`
              : "Les sections regroupent les projets dans la liste et se replient d’un clic."}
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-sm font-medium">
          Nom de la section
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Clients, Formations…"
            maxLength={60}
            autoComplete="off"
          />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            data-dialog-submit
            disabled={!name.trim()}
            onClick={() => {
              onSubmit(name.trim());
              onOpenChange(false);
            }}
          >
            {renaming ? "Renommer" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
