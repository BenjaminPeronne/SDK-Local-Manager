"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { FALLBACK_APP_VERSION } from "@/lib/desktop-runtime";
import { formatReleaseDate, shouldAnnounceReleaseNotes } from "@/lib/release-notes";
import type { ReleaseNotes, ReleaseNotesEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SEEN_VERSION_KEY = "sdk-local-manager.release-notes-seen";

function NotesList({ entries, current }: { entries: ReleaseNotesEntry[]; current?: string }) {
  return (
    <ol className="grid gap-4">
      {entries.map((entry) => (
        <li key={entry.version}>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold tabular-nums">Version {entry.version}</span>
            <span className="text-xs text-muted-foreground">{formatReleaseDate(entry.date)}</span>
            {entry.version === current && <Badge variant="success">Installée</Badge>}
          </div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {entry.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** Nouveautés de la mise à jour proposée, puis celles de la version installée et des précédentes. */
export function ReleaseNotesDialog({
  open,
  onOpenChange,
  title = "Nouveautés",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}) {
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<ReleaseNotes>("/api/app-update/notes")
      .then((payload) => {
        if (cancelled) return;
        setNotes(payload);
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Lecture impossible.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Ce qui change d’une version à l’autre.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!notes && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Lecture en cours…
          </p>
        )}
        {notes && (
          <div className="grid gap-5">
            {(notes.upcoming.length > 0 || notes.upcoming_error) && (
              <section className="rounded-md border border-primary/40 bg-primary/5 p-3">
                <h3 className="mb-2 text-sm font-semibold">Dans la mise à jour</h3>
                {notes.upcoming_error ? (
                  <p className="text-sm text-muted-foreground">{notes.upcoming_error}</p>
                ) : (
                  <NotesList entries={notes.upcoming} />
                )}
              </section>
            )}
            {notes.installed.length > 0 ? (
              <NotesList entries={notes.installed} current={notes.current} />
            ) : (
              <p className="text-sm text-muted-foreground">Aucune nouveauté enregistrée pour cette version.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Lien « Voir les nouveautés » qui ouvre la fenêtre des nouveautés. */
export function ReleaseNotesLink({ label = "Voir les nouveautés", className }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>
      <ReleaseNotesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Lit puis retient la version vue ; vrai juste après une mise à jour. Hors navigateur : faux. */
// Gardé pour la page : le mode strict de React appelle deux fois l'initialisation de l'état.
let announcement: boolean | undefined;

function announceOnce() {
  if (typeof window === "undefined") return false;
  if (announcement !== undefined) return announcement;
  try {
    const seen = window.localStorage.getItem(SEEN_VERSION_KEY);
    window.localStorage.setItem(SEEN_VERSION_KEY, FALLBACK_APP_VERSION);
    announcement = shouldAnnounceReleaseNotes(seen, FALLBACK_APP_VERSION);
  } catch {
    announcement = false;
  }
  return announcement;
}

/** Ouvre une fois les nouveautés au premier lancement qui suit une mise à jour. */
export function ReleaseNotesAfterUpdate() {
  const [open, setOpen] = useState(announceOnce);
  return (
    <ReleaseNotesDialog open={open} onOpenChange={setOpen} title={`Nouveautés de la version ${FALLBACK_APP_VERSION}`} />
  );
}
