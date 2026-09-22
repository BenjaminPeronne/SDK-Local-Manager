"use client";

import type { Dispatch, SetStateAction } from "react";
import { Rocket } from "lucide-react";
import type { MigrationCandidate, MigrationSnapshot } from "@/lib/types";
import { Notice } from "@/components/common/notice";
import { MigrationProposal } from "@/components/projects/migration-proposal";

type MigrationNoticeProps = {
  dismissMigrationProposal: () => Promise<void>;
  loading: boolean;
  migration: MigrationSnapshot | null;
  migrationCandidates: MigrationCandidate[];
  requestProjectMigration: (project: string, force?: boolean) => Promise<void>;
  setMigrationBannerClosed: Dispatch<SetStateAction<boolean>>;
};

export function MigrationNotice({
  dismissMigrationProposal,
  loading,
  migration,
  migrationCandidates,
  requestProjectMigration,
  setMigrationBannerClosed,
}: MigrationNoticeProps) {
  return (
    <Notice
      tone="success"
      icon={Rocket}
      title="Ces projets peuvent démarrer bien plus vite"
      onDismiss={() => setMigrationBannerClosed(true)}
      dismissLabel="Masquer jusqu’au prochain démarrage"
    >
      <span title={migration?.source}>
        Ils sont encore rangés sur ton disque Windows, où Odoo met près d’une minute à démarrer ; ici, quelques
        secondes. Le gestionnaire en fait une copie et ne touche pas au dossier d’origine.
      </span>
      <div className="mt-3 flex flex-col gap-3">
        <MigrationProposal candidates={migrationCandidates} loading={loading} onMigrate={requestProjectMigration} />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <button
            type="button"
            className="underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void dismissMigrationProposal()}
          >
            Ne plus proposer
          </button>
          <span>Les projets resteront copiables depuis Paramètres, section Général.</span>
        </div>
      </div>
    </Notice>
  );
}
