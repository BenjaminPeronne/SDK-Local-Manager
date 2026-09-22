"use client";

import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type StagingCleanupNoticeProps = {
  loading: boolean;
  requestStagingCleanup: () => Promise<void>;
  count: number;
};

export function StagingCleanupNotice({ loading, requestStagingCleanup, count }: StagingCleanupNoticeProps) {
  return (
    <Notice
      tone="neutral"
      icon={Trash2}
      title="Créations de projet interrompues"
      actions={
        <Button
          className="w-full sm:w-auto"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={requestStagingCleanup}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Nettoyer
        </Button>
      }
    >
      {count} dossier(s) de préparation occupent de l’espace disque sans servir à aucun projet. Les supprimer ne touche
      à aucun projet ni à aucune base.
    </Notice>
  );
}
