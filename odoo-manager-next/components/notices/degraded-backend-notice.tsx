"use client";

import { AlertTriangle, ExternalLink, RefreshCcw } from "lucide-react";
import { desktopBridge } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type DegradedBackendNoticeProps = {
  degradedBackendReason: string;
  openUrl: (url?: string) => Promise<void>;
};

export function DegradedBackendNotice({ degradedBackendReason, openUrl }: DegradedBackendNoticeProps) {
  return (
    <Notice
      tone="warning"
      icon={AlertTriangle}
      title="Mode Windows, plus lent"
      actions={
        <>
          <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => openUrl("https://aka.ms/enablevirtualization")}>
            <ExternalLink className="h-4 w-4" />
            Guide Microsoft
          </Button>
          <Button className="w-full sm:w-auto" size="sm" disabled={!desktopBridge()?.relaunch} onClick={() => desktopBridge()?.relaunch?.()}>
            <RefreshCcw className="h-4 w-4" />
            Relancer
          </Button>
        </>
      }
    >
      {degradedBackendReason} Les projets restent utilisables depuis Windows, mais Odoo y démarre en une minute environ, contre quelques secondes dans l’environnement Linux.
    </Notice>
  );
}
