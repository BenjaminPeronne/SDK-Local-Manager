"use client";

import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";
import type { AddonLinksStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type AddonLinksNoticeProps = {
  addonLinks: AddonLinksStatus;
  convertWslAddonLinks: () => Promise<void>;
  loading: boolean;
  refreshAddonLinks: () => Promise<void>;
  selectedProjectOnline: boolean;
};

export function AddonLinksNotice({
  addonLinks,
  convertWslAddonLinks,
  loading,
  refreshAddonLinks,
  selectedProjectOnline,
}: AddonLinksNoticeProps) {
  return (
    <Notice
      tone="warning"
      icon={AlertTriangle}
      title={
        addonLinks.interrupted ? "Réparation des modules interrompue" : "Ce projet est ralenti par une ancienne version"
      }
      actions={
        <>
          <Button
            className="w-full sm:w-auto"
            size="sm"
            disabled={loading || !addonLinks.native_symlinks || selectedProjectOnline}
            onClick={convertWslAddonLinks}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {addonLinks.interrupted ? "Reprendre la réparation" : "Réparer"}
          </Button>
          <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => void refreshAddonLinks()}>
            Vérifier à nouveau
          </Button>
        </>
      }
    >
      {addonLinks.interrupted
        ? "Relance la réparation pour la terminer : en attendant, certains modules peuvent manquer."
        : `${addonLinks.wsl_links} raccourci(s) vers des modules ont été créés par une ancienne version de l’application. Windows les lit mal, ce qui rend la liste des modules très lente. La réparation les recrée correctement, sans rien changer d’autre.`}
      {!addonLinks.native_symlinks && (
        <div className="mt-1 text-xs opacity-80">
          Active d’abord le mode développeur Windows : Paramètres &gt; Système &gt; Espace développeurs.
        </div>
      )}
      {addonLinks.native_symlinks && selectedProjectOnline && (
        <div className="mt-1 text-xs opacity-80">Arrête le projet avant la réparation.</div>
      )}
    </Notice>
  );
}
