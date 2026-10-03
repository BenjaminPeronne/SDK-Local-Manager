"use client";

import { useState } from "react";
import { UserCheck } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type TestUserDialogProps = {
  canUseDb: boolean;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedDatabaseOrNotify: (action: string) => string;
  selectedDb: string;
  selectedProject: Project | undefined;
};

export function TestUserDialog({
  canUseDb,
  createJob,
  loading,
  onOpenChange,
  open,
  selectedDatabaseOrNotify,
  selectedDb,
  selectedProject,
}: TestUserDialogProps) {
  const [login, setLogin] = useState("recette");
  const [withSettings, setWithSettings] = useState(false);
  const trimmedLogin = login.trim();

  async function confirmTestUser() {
    const db = selectedDatabaseOrNotify("la création de l’utilisateur de recette");
    if (!db || !selectedProject || !trimmedLogin) return;
    const job = await createJob("create_test_user", {
      project: selectedProject.name,
      db,
      login: trimmedLogin,
      with_settings: withSettings,
    });
    if (job) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Utilisateur de recette · {selectedDb || "base"}</DialogTitle>
          <DialogDescription>
            Crée un compte qui a tous les droits sur les applications installées, sauf les Ressources humaines : fiches
            employés, paie, congés, recrutement, notes de frais. Si le compte existe déjà, ses droits sont remis à jour.
            Odoo sera arrêté brièvement. Le détail des droits donnés s’affiche dans le suivi de la tâche.
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-2 text-sm">
          <span>Identifiant</span>
          <Input value={login} autoComplete="off" maxLength={64} onChange={(event) => setLogin(event.target.value)} />
          <span className="block text-xs text-muted-foreground">
            Le mot de passe sera identique : {trimmedLogin || "…"}
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-md border bg-muted/35 p-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={withSettings}
            onCheckedChange={(checked) => setWithSettings(checked === true)}
          />
          <span>
            <span className="block font-medium">Donner accès aux Paramètres</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Permet de régler les applications, mais aussi de modifier les droits des utilisateurs, y compris les siens
              : le compte pourrait alors s’ouvrir les Ressources humaines.
            </span>
          </span>
        </label>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
          À utiliser uniquement sur une copie locale ou une base de test : le mot de passe est facile à deviner.
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button disabled={!canUseDb || loading || !trimmedLogin} onClick={confirmTestUser}>
            <UserCheck className="h-4 w-4" />
            Créer l’utilisateur
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
