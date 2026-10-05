"use client";

import { ShieldAlert } from "lucide-react";
import { Notice } from "@/components/common/notice";

// Où activer le chiffrement, dans les mots des réglages de chaque système.
const HOW_TO_ENCRYPT: Record<string, string> = {
  darwin: "Active FileVault dans Réglages Système, section Confidentialité et sécurité.",
  win32:
    "Active le chiffrement dans Paramètres, section Confidentialité et sécurité, Chiffrement de l’appareil. " +
    "Si cette option n’existe pas, active BitLocker depuis le Panneau de configuration.",
  linux: "Sous Linux, le chiffrement se choisit à l’installation du système.",
};

type DiskEncryptionNoticeProps = {
  platform: string;
  onDismiss: () => void;
};

export function DiskEncryptionNotice({ platform, onDismiss }: DiskEncryptionNoticeProps) {
  return (
    <Notice
      tone="warning"
      icon={ShieldAlert}
      title="Le disque de cet ordinateur n’est pas chiffré"
      onDismiss={onDismiss}
      dismissLabel="Masquer pendant 30 jours"
    >
      Si l’ordinateur est perdu ou volé, les bases de tes clients peuvent être lues sans ton mot de passe.{" "}
      {HOW_TO_ENCRYPT[platform] ?? "Active le chiffrement du disque dans les réglages du système."} En cas de doute,
      demande au support informatique.
    </Notice>
  );
}
