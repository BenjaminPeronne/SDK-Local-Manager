"use client";

import type { Dispatch, SetStateAction } from "react";
import { Languages, Loader2 } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type AllTranslationsResetDialogProps = {
  canUseDb: boolean;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedDatabaseOrNotify: (action: string) => string;
  selectedDb: string;
  selectedProject: Project | undefined;
  selectedTranslationLanguages: Set<string>;
  setSelectedTranslationLanguages: Dispatch<SetStateAction<Set<string>>>;
  translationLanguages: { code: string; name: string; }[] | null;
};

export function AllTranslationsResetDialog({ canUseDb, createJob, loading, onOpenChange, open, selectedDatabaseOrNotify, selectedDb, selectedProject, selectedTranslationLanguages, setSelectedTranslationLanguages, translationLanguages }: AllTranslationsResetDialogProps) {
  async function confirmAllTranslationsReset() {
    const db = selectedDatabaseOrNotify("la réinitialisation des traductions");
    if (!db || !selectedProject || !selectedTranslationLanguages.size) return;
    const allSelected = selectedTranslationLanguages.size === translationLanguages?.length;
    const job = await createJob("reset_all_translations", {
      project: selectedProject.name,
      db,
      languages: allSelected ? "" : Array.from(selectedTranslationLanguages).join(","),
    });
    if (job) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Réinitialiser les traductions · {selectedDb || "base"}</DialogTitle>
          <DialogDescription>
            Recharge les termes de <strong>tous les modules installés</strong> depuis leurs fichiers <code className="text-xs">.po</code>,
            comme l’option « Écraser les termes existants » de Paramètres › Traductions › Langues. Les données et les vues ne sont
            pas mises à jour. Odoo sera arrêté brièvement.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-sm font-medium">Langues</div>
          {translationLanguages === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lecture des langues installées…
            </p>
          ) : translationLanguages.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {translationLanguages.map((language) => (
                <label key={language.code} className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm hover:bg-hover">
                  <Checkbox
                    checked={selectedTranslationLanguages.has(language.code)}
                    onCheckedChange={(checked) =>
                      setSelectedTranslationLanguages((current) => {
                        const next = new Set(current);
                        if (checked === true) next.add(language.code);
                        else next.delete(language.code);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{language.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{language.code}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune langue active trouvée dans la base.</p>
          )}
        </div>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
          Les traductions modifiées à la main dans Odoo seront écrasées pour les langues sélectionnées.
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={!canUseDb || loading || !selectedTranslationLanguages.size} onClick={confirmAllTranslationsReset}>
            <Languages className="h-4 w-4" />
            Réinitialiser ({selectedTranslationLanguages.size} langue{selectedTranslationLanguages.size > 1 ? "s" : ""})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
