"use client";

import { Archive, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Choix envoyé au serveur (voir LOCAL_CHANGES_CHOICES) : mettre de côté ou effacer. */
export type LocalChangesChoice = "stash" | "discard";

/**
 * Le dossier du dépôt contient des fichiers modifiés à la main, pas encore enregistrés : avant de changer
 * de branche ou de mettre à jour, l'utilisateur choisit de les garder de côté ou de les effacer.
 */
export function LocalChangesDialog({
  open,
  onOpenChange,
  repositoryName,
  files,
  submitting,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositoryName: string;
  files: string[];
  submitting: boolean;
  onChoose: (choice: LocalChangesChoice) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Des fichiers ont été modifiés dans {repositoryName}</DialogTitle>
          <DialogDescription>
            {files.length === 1 ? "Un fichier a été changé" : `${files.length} fichiers ont été changés`} dans ce
            dossier sans être enregistrés. Pour continuer, choisis ce qu’on en fait.
          </DialogDescription>
        </DialogHeader>
        <details className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Voir les fichiers concernés</summary>
          <ul className="mt-2 grid max-h-40 gap-1 overflow-y-auto font-mono text-xs">
            {files.map((file) => (
              <li key={file} className="break-all">
                {file}
              </li>
            ))}
          </ul>
        </details>
        <div className="grid gap-2">
          <ChoiceButton
            icon={<Archive className="h-5 w-5 text-primary" />}
            title="Les garder de côté (conseillé)"
            text="Tes changements sont rangés à part, rien n’est perdu : tu pourras les récupérer plus tard."
            disabled={submitting}
            onClick={() => onChoose("stash")}
          />
          <ChoiceButton
            icon={<Trash2 className="h-5 w-5 text-destructive" />}
            title="Les effacer"
            text="Les fichiers reviennent à leur dernière version enregistrée. Tes changements seront perdus pour de bon."
            disabled={submitting}
            onClick={() => onChoose("discard")}
          />
        </div>
        <div className="flex justify-end">
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Annuler
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceButton({
  icon,
  title,
  text,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-start gap-3 rounded-md border p-3 text-left transition-colors hover:border-primary/50 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{text}</span>
      </span>
    </button>
  );
}
