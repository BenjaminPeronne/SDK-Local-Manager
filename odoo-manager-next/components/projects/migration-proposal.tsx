"use client";

import { AlertTriangle, Rocket } from "lucide-react";
import { formatNameList } from "@/lib/format";
import type { MigrationCandidate } from "@/lib/types";
import { Button } from "@/components/ui/button";

// Proposition de copie d'un projet resté sur le disque d'origine. Partagée par le bandeau
// d'accueil et les réglages : masquer le bandeau ne doit jamais retirer l'accès à la copie.
export function MigrationProposal({
  candidates,
  loading,
  onMigrate,
}: {
  candidates: MigrationCandidate[];
  loading: boolean;
  onMigrate: (project: string, force: boolean) => void;
}) {
  const open = candidates.filter((candidate) => !candidate.stopped && candidate.engine_confirmed);
  const unsure = candidates.filter((candidate) => !candidate.stopped && !candidate.engine_confirmed);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {candidates.map((candidate) => (
          <Button
            key={candidate.name}
            size="sm"
            variant="outline"
            disabled={(!candidate.stopped && candidate.engine_confirmed) || loading}
            onClick={() => onMigrate(candidate.name, !candidate.stopped)}
          >
            <Rocket className="h-4 w-4" />
            {candidate.name}
            {!candidate.stopped && (candidate.engine_confirmed ? " (ouvert)" : " (à vérifier)")}
          </Button>
        ))}
      </div>
      {/* Un bouton désactivé n'affiche pas son title : la raison doit rester lisible sans survol. */}
      {open.length > 0 && (
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {formatNameList(open.map((candidate) => candidate.name))} {open.length > 1 ? "tournent" : "tourne"} en ce
            moment. {open.length > 1 ? "Arrête-les" : "Arrête-le"} avant de copier : la copie partirait en plein
            travail. Le bouton se réactive tout seul.
          </span>
        </div>
      )}
      {unsure.length > 0 && (
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {formatNameList(unsure.map((candidate) => candidate.name))}{" "}
            {unsure.length > 1 ? "se sont mal arrêtés" : "s’est mal arrêté"} la dernière fois : il en reste une trace,
            mais plus rien ne tourne. Vérifie que personne ne {unsure.length > 1 ? "les" : "l’"}utilise, puis lance la
            copie — le dossier d’origine n’est pas modifié.
          </span>
        </div>
      )}
    </>
  );
}
