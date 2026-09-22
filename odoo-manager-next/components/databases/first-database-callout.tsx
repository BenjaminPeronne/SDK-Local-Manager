"use client";

import { Database, PlusCircle, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Premier pas d'un projet démarré sans base : la création est l'action recommandée.
 *
 * Tant qu'aucune base n'existe, les modules et l'activité n'ont rien à montrer : l'onglet Bases
 * guide vers la seule étape utile, avec la restauration d'une sauvegarde en alternative.
 */
export function FirstDatabaseCallout({
  disabled,
  onCreate,
  onRestore,
}: {
  disabled: boolean;
  onCreate: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="rounded-lg border border-primary/40 bg-selected/60 p-6 text-center sm:p-8">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Database className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <h3 className="text-lg font-semibold">Crée la première base de ce projet</h3>
        <Badge variant="outline" className="border-primary/50 text-primary">
          Recommandé
        </Badge>
      </div>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Odoo tourne, mais aucune base n’existe encore. Une fois la base créée, ses modules et son activité apparaissent
        dans les autres onglets.
      </p>
      <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Button className="w-full px-6 sm:w-auto" disabled={disabled} onClick={onCreate}>
          <PlusCircle className="h-4 w-4" />
          Créer une base
        </Button>
        <Button className="w-full sm:w-auto" variant="outline" disabled={disabled} onClick={onRestore}>
          <Upload className="h-4 w-4" />
          Restaurer une sauvegarde
        </Button>
      </div>
    </div>
  );
}
