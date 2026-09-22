"use client";

import type { Dispatch, SetStateAction } from "react";
import { Languages } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type TranslationResetDialogProps = {
  canUseDb: boolean;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  pendingTranslationResetModules: string[];
  selectedDatabaseOrNotify: (action: string) => string;
  selectedDb: string;
  selectedProject: Project | undefined;
  setPendingTranslationResetModules: Dispatch<SetStateAction<string[]>>;
};

export function TranslationResetDialog({
  canUseDb,
  createJob,
  loading,
  pendingTranslationResetModules,
  selectedDatabaseOrNotify,
  selectedDb,
  selectedProject,
  setPendingTranslationResetModules,
}: TranslationResetDialogProps) {
  async function confirmTranslationReset() {
    const db = selectedDatabaseOrNotify("la réinitialisation des traductions");
    if (!db || !selectedProject || !pendingTranslationResetModules.length) return;
    const job = await createJob("reset_module_translations", {
      project: selectedProject.name,
      db,
      modules: pendingTranslationResetModules.join(","),
    });
    if (job) setPendingTranslationResetModules([]);
  }

  return (
    <Dialog
      open={pendingTranslationResetModules.length > 0}
      onOpenChange={(open) => {
        if (!open) setPendingTranslationResetModules([]);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Réinitialiser les traductions</DialogTitle>
          <DialogDescription>
            Les modules sont mis à jour sur {selectedDb || "la base sélectionnée"} avec{" "}
            <code className="text-xs">--i18n-overwrite</code> : les traductions sont rechargées depuis les fichiers{" "}
            <code className="text-xs">.po</code> du code.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
          Les traductions modifiées à la main dans Odoo pour ces modules seront écrasées.
        </div>
        <div className="max-h-52 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {pendingTranslationResetModules.map((name) => (
            <div key={name}>{name}</div>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setPendingTranslationResetModules([])}>
            Annuler
          </Button>
          <Button disabled={!canUseDb || loading} onClick={confirmTranslationReset}>
            <Languages className="h-4 w-4" />
            Réinitialiser ({pendingTranslationResetModules.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
