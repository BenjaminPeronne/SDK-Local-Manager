"use client";

import { CalendarPlus, Loader2, Timer } from "lucide-react";
import { deletionLabel, type UpcomingDeletion } from "@/lib/retention";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/notice";

type RetentionNoticeProps = {
  deletions: UpcomingDeletion[];
  extending: string;
  extendDatabaseRetention: (project: string, db: string) => void;
};

export function RetentionNotice({ deletions, extending, extendDatabaseRetention }: RetentionNoticeProps) {
  const soonest = deletions[0];
  return (
    <Notice
      tone={soonest && soonest.days <= 1 ? "danger" : "warning"}
      icon={Timer}
      title={deletions.length > 1 ? "Des bases seront bientôt supprimées" : "Une base sera bientôt supprimée"}
    >
      <p>
        Pour protéger les données des clients, une base est supprimée 30 jours après son arrivée sur cet ordinateur. Si
        tu en as encore besoin, garde-la 30 jours de plus.
      </p>
      <ul className="mt-3 space-y-2">
        {deletions.map((deletion) => {
          const key = `${deletion.project}/${deletion.db}`;
          return (
            <li key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-all">
                <span className="font-medium">{deletion.project}</span> · {deletion.db} ·{" "}
                {deletionLabel(deletion.expiresAt).text.toLowerCase()}
              </span>
              <Button
                className="w-full shrink-0 sm:w-auto"
                size="sm"
                variant="outline"
                disabled={Boolean(extending)}
                onClick={() => extendDatabaseRetention(deletion.project, deletion.db)}
              >
                {extending === key ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarPlus className="h-4 w-4" />
                )}
                Garder 30 jours de plus
              </Button>
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}
