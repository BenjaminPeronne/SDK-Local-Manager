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
        addonLinks.interrupted
          ? "Conversion des liens d’addons interrompue"
          : "Liens d’addons créés par une ancienne version"
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
            {addonLinks.interrupted ? "Reprendre la conversion" : "Convertir les liens"}
          </Button>
          <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => void refreshAddonLinks()}>
            Vérifier à nouveau
          </Button>
        </>
      }
    >
      {addonLinks.interrupted
        ? "Relance la conversion pour la terminer : certains modules peuvent être absents tant qu’elle n’est pas achevée."
        : `${addonLinks.wsl_links} lien(s) de ce projet ont été créés par WSL. Windows ne peut pas les lire, ce qui ralentit fortement la liste des modules. La conversion les remplace par des liens Windows identiques, lus par Windows et par Docker.`}
      {!addonLinks.native_symlinks && (
        <div className="mt-1 text-xs opacity-80">
          Active d’abord le mode développeur Windows : Paramètres &gt; Système &gt; Espace développeurs.
        </div>
      )}
      {addonLinks.native_symlinks && selectedProjectOnline && (
        <div className="mt-1 text-xs opacity-80">Arrête le projet avant la conversion.</div>
      )}
    </Notice>
  );
}
