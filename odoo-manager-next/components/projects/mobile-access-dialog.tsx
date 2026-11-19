"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, Square } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { waitForJob } from "@/lib/api";
import { desktopBridge, desktopErrorMessage } from "@/lib/desktop";
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
  // Revérifié à chaque ouverture : un accès déjà ouvert garde l'adresse Wi-Fi d'avant un changement de réseau.
  const [checked, setChecked] = useState(false);
  const ready = Boolean(checked && project && mobile?.running && mobile.project === project.name);
  // Sous Windows, l'adresse donnée au téléphone est celle du relais Wi-Fi de l'application.
  const relay = desktopBridge()?.wslLanRelay;
  const [relayBase, setRelayBase] = useState("");
  const phoneBase = relay ? relayBase : (mobile?.url ?? "");
  // Pare-feu de Windows lu pour le relais : null tant qu'il n'est pas connu, ou hors Windows.
  const [firewall, setFirewall] = useState<{ state: string } | null>(null);
  const [allowing, setAllowing] = useState(false);

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
    if (started.current || !project) return;
    started.current = true;
    // Le serveur garde le relais s'il est à jour, le refait sur l'adresse actuelle sinon.
    void runJob("start_mobile_access", { project: project.name }).then(() => setChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule ouverture par affichage de la fenêtre.
  }, [project]);

  useEffect(() => {
    const base = ready ? (mobile?.url ?? "") : "";
    if (!base || !relay) return;
    let current = true;
    relay(base).then(
      (address) => current && setRelayBase(address),
      (err) => current && setError(desktopErrorMessage(err, "Le Wi-Fi de ce poste n'a pas pu être ouvert.")),
    );
    return () => {
      current = false;
    };
  }, [ready, mobile?.url, relay]);

  useEffect(() => {
    const read = desktopBridge()?.wslLanFirewall;
    if (!relayBase || !read) return;
    let current = true;
    // Une lecture ratée ne bloque rien : l'aide générale reste affichée.
    read().then(
      (status) => current && setFirewall(status),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [relayBase]);

  async function allowPhone() {
    const bridge = desktopBridge();
    if (!bridge?.wslLanFirewallAllow || !bridge.wslLanFirewall) return;
    setAllowing(true);
    try {
      await bridge.wslLanFirewallAllow();
      setFirewall(await bridge.wslLanFirewall());
    } catch (err) {
      setError(desktopErrorMessage(err, "Le pare-feu de Windows n'a pas pu être réglé."));
    }
    setAllowing(false);
  }

  async function closeAccess() {
    setClosing(true);
    await desktopBridge()
      ?.wslLanRelayStop?.()
      .catch(() => undefined);
    if (await runJob("stop_mobile_access")) onClose();
    setClosing(false);
  }

  const url = ready && project && phoneBase ? odooAccessUrl({ ...project, url: phoneBase }, db) : "";

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
          {firewall && firewall.state !== "allowed" && (
            <div
              role="alert"
              className="flex w-full flex-col items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-center text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100"
            >
              <p>
                {firewall.state === "blocked"
                  ? "Le pare-feu de Windows empêche le téléphone de joindre ce poste."
                  : "Windows n'a pas encore autorisé le téléphone à joindre ce poste."}{" "}
                Windows va demander une confirmation : clique sur « Oui ».
              </p>
              <Button size="sm" disabled={allowing} onClick={() => void allowPhone()}>
                {allowing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Autoriser le téléphone
              </Button>
            </div>
          )}
          {/* Le poste ne voit pas ce qui bloque le téléphone : ces trois causes se règlent de son côté. */}
          <p className="text-center text-xs text-muted-foreground">
            La page ne s&apos;ouvre pas sur le téléphone ? Vérifie qu&apos;il est sur le même Wi-Fi que ce poste, coupe
            le VPN de ce poste s&apos;il y en a un, et autorise cette application et Docker dans le pare-feu de ce
            poste.
          </p>
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
