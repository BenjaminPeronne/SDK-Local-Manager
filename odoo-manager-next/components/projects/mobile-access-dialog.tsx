"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { waitForJob } from "@/lib/api";
import { odooAccessUrl } from "@/lib/projects";
import type { Job, MobileAccessStatus, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type MobileAccessDialogProps = {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  /** Base ouverte par le QR code ; vide : Odoo propose le choix de la base. */
  db: string;
  mobile: MobileAccessStatus | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  project: Project | undefined;
  refreshSystemStatus: () => Promise<void>;
};

export function MobileAccessDialog({ onOpenChange, open, ...content }: MobileAccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Monté à chaque ouverture : l'accès s'ouvre seul, sans étape à valider. */}
        <MobileAccessContent {...content} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function MobileAccessContent({
  createJob,
  db,
  mobile,
  onClose,
  project,
  refreshSystemStatus,
}: Omit<MobileAccessDialogProps, "onOpenChange" | "open"> & { onClose: () => void }) {
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const started = useRef(false);
  const ready = Boolean(project && mobile?.running && mobile.project === project.name);

  async function runJob(action: string, payload?: Record<string, unknown>) {
    try {
      const job = await createJob(action, payload);
      if (!job) throw new Error("L'action n'a pas pu être lancée. Réessaie.");
      await waitForJob(job.id);
      await refreshSystemStatus();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'action a échoué.");
      return false;
    }
  }

  useEffect(() => {
    if (ready || started.current || !project) return;
    started.current = true;
    void runJob("start_mobile_access", { project: project.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule ouverture par affichage de la fenêtre.
  }, [ready, project]);

  async function closeAccess() {
    setClosing(true);
    if (await runJob("stop_mobile_access")) onClose();
    setClosing(false);
  }

  const url = ready && project ? odooAccessUrl({ ...project, url: mobile?.url ?? "" }, db) : "";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ouvrir sur mobile · {db || project?.name}</DialogTitle>
        <DialogDescription>
          Scanne ce code avec l&apos;appareil photo du téléphone, connecté au même Wi-Fi que ce poste.
        </DialogDescription>
      </DialogHeader>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : url ? (
        <div className="flex flex-col items-center gap-3">
          {/* Fond blanc même en thème sombre : un code clair sur fond sombre se lit mal. */}
          <div className="rounded-md bg-white p-3">
            <QRCodeSVG value={url} size={224} title={`QR code vers ${url}`} />
          </div>
          <p className="break-all text-center font-mono text-xs text-muted-foreground select-text">{url}</p>
        </div>
      ) : (
        <p role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Préparation de l&apos;accès…
        </p>
      )}
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
        Les échanges ne sont pas chiffrés : à utiliser uniquement sur un Wi-Fi de confiance. L&apos;accès reste ouvert
        après cette fenêtre, jusqu&apos;à ce que tu le coupes.
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {ready && (
          <Button variant="outline" disabled={closing} onClick={() => void closeAccess()}>
            {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            Couper l&apos;accès
          </Button>
        )}
        <Button onClick={onClose}>Terminé</Button>
      </div>
    </>
  );
}
