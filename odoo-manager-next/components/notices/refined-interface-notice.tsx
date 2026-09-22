"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type RefinedInterfaceNoticeProps = {
  dismissRefinedInterfaceProposal: () => Promise<void>;
  switchToRefinedInterface: () => Promise<void>;
};

export function RefinedInterfaceNotice({
  dismissRefinedInterfaceProposal,
  switchToRefinedInterface,
}: RefinedInterfaceNoticeProps) {
  return (
    <Notice
      tone="accent"
      icon={Sparkles}
      title="Essaie la nouvelle interface (bêta)"
      onDismiss={() => void dismissRefinedInterfaceProposal()}
      dismissLabel="Ne plus proposer"
      actions={
        <Button className="w-full sm:w-auto" size="sm" onClick={() => void switchToRefinedInterface()}>
          <Sparkles className="h-4 w-4" />
          Passer à la nouvelle interface
        </Button>
      }
    >
      Présentation affinée et en-tête fixe : le nom du projet et ses actions restent visibles pendant le défilement.
      Retour à l’interface classique possible à tout moment dans Paramètres, section Apparence.
    </Notice>
  );
}
