"use client";

import { useEffect, useRef, useState } from "react";
import { CloudDownload, HardDrive, Loader2, Upload } from "lucide-react";
import type { Project, RemoteBackup, RestoreDatabasePayload, RestoreRemoteBackupPayload } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";
import { RemoteBackupPicker } from "@/components/databases/remote-backup-picker";
import { SimplifiedNeutralizationNotice } from "@/components/databases/simplified-neutralization-notice";
import { databaseNameError } from "@/lib/database-name";
import { formatBytes } from "@/lib/format";

export function RestoreDatabaseDialog({
  open,
  onOpenChange,
  project,
  onSubmit,
  onSubmitRemote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSubmit: (payload: RestoreDatabasePayload, onProgress: (progress: number) => void) => Promise<boolean>;
  onSubmitRemote: (payload: RestoreRemoteBackupPayload) => Promise<boolean>;
}) {
  const [source, setSource] = useState<"computer" | "sudokeys">("computer");
  const [remoteBackup, setRemoteBackup] = useState<RemoteBackup | null>(null);
  const [db, setDb] = useState("");
  const [neutralize, setNeutralize] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const submittingRef = useRef(false);
  const nameError = databaseNameError(db, project?.databases);

  useEffect(() => {
    setDb("");
    setFile(null);
    setRemoteBackup(null);
    setProgress(0);
  }, [project?.name]);

  function selectRemoteBackup(backup: RemoteBackup | null) {
    setRemoteBackup(backup);
    // Nom proposé d'après la base sauvegardée, sans la date qui suit dans le nom du fichier.
    if (backup && !db.trim()) setDb(backup.database.split("__")[0]);
  }

  async function submitRemote() {
    if (!project || !remoteBackup || nameError) return false;
    const successful = await onSubmitRemote({
      project: project.name,
      db,
      neutralize,
      backup: remoteBackup.id,
    });
    if (successful) {
      setDb("");
      setRemoteBackup(null);
    }
    return successful;
  }

  async function submit() {
    if (!project || nameError || submittingRef.current || (source === "computer" ? !file : !remoteBackup)) return;
    submittingRef.current = true;
    setSubmitting(true);
    setProgress(0);
    try {
      if (source === "sudokeys") {
        await submitRemote();
      } else if (file) {
        const successful = await onSubmit({ project: project.name, db, copy: true, neutralize, file }, setProgress);
        if (successful) {
          setDb("");
          setFile(null);
          setProgress(0);
        }
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Restaurer une sauvegarde Odoo</DialogTitle>
          <DialogDescription>
            {project
              ? `Projet cible : ${project.name}. La version sera vérifiée si elle peut être déterminée ; l’espace disponible sera contrôlé avant le chargement.`
              : "Sélectionne un projet."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">1. Choisir la source</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Origine de la sauvegarde">
              <Button
                variant={source === "computer" ? "secondary" : "outline"}
                aria-pressed={source === "computer"}
                disabled={submitting}
                onClick={() => setSource("computer")}
              >
                <HardDrive className="h-4 w-4" />
                Depuis mon ordinateur
              </Button>
              <Button
                variant={source === "sudokeys" ? "secondary" : "outline"}
                aria-pressed={source === "sudokeys"}
                disabled={submitting}
                onClick={() => setSource("sudokeys")}
              >
                <CloudDownload className="h-4 w-4" />
                Sauvegardes Sudokeys
              </Button>
            </div>
          </div>

          <section aria-labelledby="restore-backup-title" className="space-y-2">
            <h3 id="restore-backup-title" className="text-sm font-semibold">
              2. Choisir la sauvegarde
            </h3>
            {source === "sudokeys" ? (
              <RemoteBackupPicker selected={remoteBackup} disabled={submitting} onSelect={selectRemoteBackup} />
            ) : (
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
            )}
          </section>

          <section aria-labelledby="restore-options-title" className="space-y-3">
            <h3 id="restore-options-title" className="text-sm font-semibold">
              3. Nom et options
            </h3>
            <label className="grid gap-1.5 text-sm font-medium">
              Nom de la nouvelle base
              <Input
                value={db}
                disabled={submitting}
                onChange={(event) => setDb(event.target.value)}
                placeholder="client_recette"
                aria-invalid={Boolean(db && nameError)}
                aria-describedby="restore-db-name-hint"
              />
              <span
                id="restore-db-name-hint"
                className={
                  db && nameError ? "text-xs font-normal text-destructive" : "text-xs font-normal text-muted-foreground"
                }
              >
                {db && nameError ? nameError : "63 octets maximum, sans barre oblique ni espaces aux extrémités."}
              </span>
            </label>

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
                  Recommandé en local : contrôle notamment les tâches planifiées, les serveurs de messagerie et la
                  synchronisation bancaire. Certaines connexions propres aux modules peuvent rester actives :
                  vérifie-les avant d’utiliser la base. La restauration est toujours déclarée comme une copie.
                </span>
              </span>
            </label>

            {neutralize && <SimplifiedNeutralizationNotice odooVersion={project?.odoo_version} />}
          </section>

          <section aria-labelledby="restore-summary-title" className="rounded-md border bg-muted/30 p-3 text-sm">
            <h3 id="restore-summary-title" className="font-semibold">
              4. Vérifier avant de lancer
            </h3>
            <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-3">
              <dt className="text-muted-foreground">Projet</dt>
              <dd className="break-all font-medium">{project?.name || "Non sélectionné"}</dd>
              <dt className="text-muted-foreground">Nouvelle base</dt>
              <dd className="break-all font-medium">{db || "Nom à renseigner"}</dd>
              <dt className="text-muted-foreground">Sauvegarde</dt>
              <dd className="break-all">
                {source === "computer"
                  ? file
                    ? `${file.name} · ${formatBytes(file.size)}`
                    : "Fichier à choisir"
                  : remoteBackup
                    ? `${remoteBackup.filename} · ${formatBytes(remoteBackup.size)}`
                    : "Sauvegarde à choisir"}
              </dd>
              <dt className="text-muted-foreground">Neutralisation</dt>
              <dd>{neutralize ? "Activée" : "Désactivée"}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Le serveur Odoo du projet sera arrêté temporairement pendant la restauration ; ses autres bases seront
              alors indisponibles.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Après le lancement, suis les étapes dans Activité. En cas d’arrêt, le gestionnaire tentera de nettoyer la
              base partielle et indiquera le résultat dans le journal.
            </p>
            {!neutralize && (
              <p className="mt-2 text-xs font-medium text-destructive">
                Les connexions et automatisations de la sauvegarde peuvent rester actives. Vérifie-les avant
                utilisation.
              </p>
            )}
          </section>

          {submitting && source === "computer" && (
            <div className="grid gap-2" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">Étape 1 : envoi du fichier au gestionnaire</span>
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
                <p className="text-xs text-muted-foreground">
                  Envoi terminé. Validation du ZIP avant le lancement de la restauration ; la base n’est pas encore
                  restaurée.
                </p>
              )}
            </div>
          )}

          {source === "sudokeys" && remoteBackup && (
            <p className="text-xs text-muted-foreground">
              La sauvegarde est d’abord téléchargée sur ce poste, puis restaurée. Le suivi s’affiche dans les actions.
            </p>
          )}

          <Button
            className="w-full"
            disabled={!project || !(source === "sudokeys" ? remoteBackup : file) || Boolean(nameError) || submitting}
            onClick={submit}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : source === "sudokeys" ? (
              <CloudDownload className="h-4 w-4" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {submitting
              ? "Préparation de la restauration…"
              : source === "sudokeys"
                ? "Récupérer et restaurer la base"
                : "Restaurer la base"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
