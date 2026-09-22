"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type AdminPasswordDialogProps = {
  canUseDb: boolean;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedDatabaseOrNotify: (action: string) => string;
  selectedDb: string;
  selectedProject: Project | undefined;
};

export function AdminPasswordDialog({
  canUseDb,
  createJob,
  loading,
  onOpenChange,
  open,
  selectedDatabaseOrNotify,
  selectedDb,
  selectedProject,
}: AdminPasswordDialogProps) {
  const [adminPassword, setAdminPassword] = useState("admin");
  async function confirmAdminPasswordReset() {
    const db = selectedDatabaseOrNotify("la réinitialisation du mot de passe admin");
    if (!db || !selectedProject || !adminPassword.trim()) return;
    const job = await createJob("reset_admin_password", { project: selectedProject.name, db, password: adminPassword });
    if (job) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mot de passe administrateur · {selectedDb || "base"}</DialogTitle>
          <DialogDescription>
            Remplace le mot de passe de l’utilisateur <code className="text-xs">base.user_admin</code> et le réactive si
            besoin. Odoo sera arrêté brièvement. L’identifiant de connexion est affiché dans les logs de la tâche.
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-2 text-sm">
          <span>Nouveau mot de passe</span>
          <Input
            value={adminPassword}
            autoComplete="off"
            maxLength={128}
            onChange={(event) => setAdminPassword(event.target.value)}
          />
        </label>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
          À utiliser uniquement sur une copie locale ou une base de test.
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button disabled={!canUseDb || loading || !adminPassword.trim()} onClick={confirmAdminPasswordReset}>
            <KeyRound className="h-4 w-4" />
            Réinitialiser
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
