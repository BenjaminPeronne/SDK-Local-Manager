"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Loader2, Timer } from "lucide-react";
import { deletionLabel, deletionMoment, type UpcomingDeletion } from "@/lib/retention";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Notice } from "@/components/common/notice";

type RetentionNoticeProps = {
  deletions: UpcomingDeletion[];
  extending: string;
  extendDatabasesRetention: (databases: { project: string; db: string }[]) => Promise<boolean>;
};

const RETENTION_RULE =
  "Pour protéger les données des clients, une base est supprimée 30 jours après son arrivée sur cet ordinateur.";

function deletionKey(deletion: UpcomingDeletion) {
  return `${deletion.project}/${deletion.db}`;
}

/**
 * Bandeau d'une ligne : la liste complète, longue dès qu'on restaure souvent des bases, s'ouvre
 * dans une fenêtre où l'on coche celles à garder. Une base seule se garde directement.
 */
export function RetentionNotice({ deletions, extending, extendDatabasesRetention }: RetentionNoticeProps) {
  const [open, setOpen] = useState(false);
  const soonest = deletions[0];
  if (!soonest) return null;
  const single = deletions.length === 1;
  const when = deletionLabel(soonest.expiresAt).text.toLowerCase();

  return (
    <>
      <Notice
        tone={soonest.days <= 1 ? "danger" : "warning"}
        icon={Timer}
        title={single ? "Une base sera bientôt supprimée" : `${deletions.length} bases seront bientôt supprimées`}
        actions={
          single ? (
            <Button
              className="w-full sm:w-auto"
              size="sm"
              variant="outline"
              disabled={Boolean(extending)}
              onClick={() => void extendDatabasesRetention([{ project: soonest.project, db: soonest.db }])}
            >
              {extending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
              Garder 30 jours de plus
            </Button>
          ) : (
            <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => setOpen(true)}>
              <CalendarPlus className="h-4 w-4" />
              Choisir les bases à garder
            </Button>
          )
        }
      >
        {single ? (
          <>
            <span className="font-medium">{soonest.project}</span> · {soonest.db} · {when}. {RETENTION_RULE}
          </>
        ) : (
          <>
            La première, <span className="font-medium">{soonest.project}</span> · {soonest.db}, sera {when}. Garde
            celles dont tu as encore besoin.
          </>
        )}
      </Notice>
      {!single && (
        <RetentionDialog
          open={open}
          onOpenChange={setOpen}
          deletions={deletions}
          extending={extending}
          extendDatabasesRetention={extendDatabasesRetention}
        />
      )}
    </>
  );
}

function RetentionDialog({
  open,
  onOpenChange,
  deletions,
  extending,
  extendDatabasesRetention,
}: RetentionNoticeProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Rien de coché d'office : garder une base de client plus longtemps doit rester un choix.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const busy = Boolean(extending);

  // Regroupées par projet, dans l'ordre de la première suppression de chacun.
  const groups = useMemo(() => {
    const byProject = new Map<string, UpcomingDeletion[]>();
    for (const deletion of deletions) {
      byProject.set(deletion.project, [...(byProject.get(deletion.project) ?? []), deletion]);
    }
    return [...byProject.entries()];
  }, [deletions]);

  const selected = deletions.filter((deletion) => checked.has(deletionKey(deletion)));
  const allChecked = selected.length === deletions.length;

  function toggle(keys: string[], keep: boolean) {
    setChecked((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (keep) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  async function keepSelected() {
    const done = await extendDatabasesRetention(selected.map(({ project, db }) => ({ project, db })));
    if (done) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setChecked(new Set());
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Bases bientôt supprimées</DialogTitle>
          <DialogDescription>
            {RETENTION_RULE} Coche celles dont tu as encore besoin : elles seront gardées 30 jours de plus.
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-center gap-2 border-b pb-3 text-sm font-medium">
          <Checkbox
            checked={allChecked ? true : selected.length ? "indeterminate" : false}
            disabled={busy}
            onCheckedChange={() => toggle(deletions.map(deletionKey), !allChecked)}
          />
          Tout sélectionner
          <span className="ml-auto font-normal text-muted-foreground">
            {selected.length} / {deletions.length}
          </span>
        </label>

        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          {groups.map(([project, projectDeletions]) => {
            const keys = projectDeletions.map(deletionKey);
            const checkedCount = keys.filter((key) => checked.has(key)).length;
            return (
              <section key={project} className="space-y-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                  <Checkbox
                    checked={checkedCount === keys.length ? true : checkedCount ? "indeterminate" : false}
                    disabled={busy}
                    onCheckedChange={() => toggle(keys, checkedCount !== keys.length)}
                  />
                  {project}
                </label>
                <ul className="space-y-1.5">
                  {projectDeletions.map((deletion) => {
                    const key = deletionKey(deletion);
                    const label = deletionLabel(deletion.expiresAt);
                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm hover:bg-hover">
                          <Checkbox
                            checked={checked.has(key)}
                            disabled={busy}
                            onCheckedChange={(value) => toggle([key], value === true)}
                          />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={deletion.db}>
                            {deletion.db}
                          </span>
                          {extending === key ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                          ) : (
                            <Badge
                              variant={label.tone === "muted" ? "secondary" : label.tone}
                              title={deletionMoment(deletion.expiresAt)}
                            >
                              {label.text}
                            </Badge>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Plus tard
          </Button>
          <Button disabled={busy || !selected.length} onClick={() => void keepSelected()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
            {selected.length
              ? `Garder ${selected.length} base${selected.length > 1 ? "s" : ""} 30 jours de plus`
              : "Garder 30 jours de plus"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
