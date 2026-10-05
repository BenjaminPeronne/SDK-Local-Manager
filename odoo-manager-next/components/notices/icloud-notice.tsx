"use client";

import { Cloud, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type ICloudNoticeProps = {
  openSettingsDialog: () => void;
};

export function ICloudNotice({ openSettingsDialog }: ICloudNoticeProps) {
  return (
    <Notice
      tone="warning"
      icon={Cloud}
      title="Tes projets sont copiés dans iCloud"
      actions={
        <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={openSettingsDialog}>
          <Settings className="h-4 w-4" />
          Paramètres
        </Button>
      }
    >
      Le dossier des projets est dans Documents ou sur le Bureau, qu’iCloud copie en ligne : les bases de tes clients
      partent sur les serveurs d’Apple, et elles peuvent s’abîmer. Déplace ce dossier ailleurs (par exemple dans ton
      dossier personnel), puis indique le nouvel emplacement dans Paramètres, section Général.
    </Notice>
  );
}
