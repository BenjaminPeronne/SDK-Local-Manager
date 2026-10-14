"use client";

import { ShieldAlert } from "lucide-react";
import { Notice } from "@/components/common/notice";

/**
 * Odoo 12, 14 et 15 n'ont pas le moteur de neutralisation apparu en 16 : le gestionnaire applique
 * alors sa propre version, limitée aux tâches planifiées, aux serveurs de messagerie et à la
 * synchronisation bancaire.
 */
export function hasSimplifiedNeutralization(odooVersion: string | undefined): boolean {
  const major = Number.parseFloat(odooVersion ?? "");
  return Number.isFinite(major) && major < 16;
}

export function SimplifiedNeutralizationNotice({ odooVersion }: { odooVersion: string | undefined }) {
  if (!hasSimplifiedNeutralization(odooVersion)) return null;
  return (
    <Notice tone="warning" icon={ShieldAlert} title={`Neutralisation partielle sur Odoo ${odooVersion}`}>
      Sur cette version, seuls les e-mails (envoi et réception), les tâches planifiées et la synchronisation avec la
      banque sont coupés. Les autres connexions externes, comme les paiements ou les SMS, restent actives : vérifie-les
      avant de tester avec cette base.
    </Notice>
  );
}
