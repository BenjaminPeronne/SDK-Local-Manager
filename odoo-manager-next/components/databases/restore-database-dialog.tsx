"use client";

import { useEffect, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import type { Project, RestoreDatabasePayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";

export function RestoreDatabaseDialog({
  open,
  onOpenChange,
  project,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSubmit: (payload: RestoreDatabasePayload, onProgress: (progress: number) => void) => Promise<boolean>;
}) {
  const [db, setDb] = useState("");
  const [masterPwd, setMasterPwd] = useState("odoo");
  const [neutralize, setNeutralize] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setDb("");
    setFile(null);
    setProgress(0);
  }, [project?.name]);

  async function submit() {
    if (!project || !file || !db.trim() || !masterPwd) return;
    setSubmitting(true);
    setProgress(0);
    const successful = await onSubmit(
      {
        project: project.name,
        db: db.trim(),
        masterPwd,
        copy: true,
        neutralize,
        file,
      },
      setProgress,
    );
    if (successful) {
      setDb("");
      setFile(null);
      setProgress(0);
    }
    setSubmitting(false);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Restaurer une sauvegarde Odoo</DialogTitle>
          <DialogDescription>
            {project
              ? `Le ZIP sera restauré dans le projet ${project.name} sans ouvrir le gestionnaire de bases Odoo.`
              : "Sélectionne un projet."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid min-w-0 gap-1.5 text-sm font-medium">
            <label htmlFor="database-backup-file">Sauvegarde ZIP Odoo</label>
            <FilePicker
              id="database-backup-file"
              accept=".zip,application/zip"
              file={file}
              buttonLabel="Choisir une sauvegarde"
              disabled={submitting}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            {file && (
              <span className="break-all text-xs font-normal text-muted-foreground">
                {file.name} · {(file.size / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo
              </span>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Nom de la nouvelle base
              <Input
                value={db}
                disabled={submitting}
                onChange={(event) => setDb(event.target.value)}
                placeholder="client_recette"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Master password
              <Input
                value={masterPwd}
                disabled={submitting}
                onChange={(event) => setMasterPwd(event.target.value)}
                type="password"
              />
            </label>
          </div>

          <label className="flex items-start gap-3 rounded-md border bg-muted/35 p-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={neutralize}
              disabled={submitting}
              onCheckedChange={(checked) => setNeutralize(checked === true)}
            />
            <span>
              <span className="block font-medium">Neutraliser la base pour les tests</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Recommandé en local : désactive notamment les envois d’e-mails et les actions externes. La restauration
                est toujours déclarée comme une copie.
              </span>
            </span>
          </label>

          {submitting && (
            <div className="grid gap-2" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">Téléversement vers le gestionnaire</span>
                <span className="tabular-nums text-muted-foreground">{progress} %</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {progress === 100 && (
                <p className="text-xs text-muted-foreground">Validation du ZIP et démarrage de la restauration…</p>
              )}
            </div>
          )}

          <Button
            className="w-full"
            disabled={!project || !file || !db.trim() || !masterPwd || submitting}
            onClick={submit}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {submitting ? "Préparation de la restauration…" : "Restaurer la base"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
