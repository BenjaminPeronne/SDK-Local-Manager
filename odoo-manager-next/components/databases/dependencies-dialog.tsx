"use client";

import { CheckCircle2, Copy, GitBranch, Loader2, PackageX, RefreshCcw, TriangleAlert } from "lucide-react";
import type { DependencyReport } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REFINED_IDENTIFIER } from "@/components/common/refined-layout";

/** Résumé en une phrase, repris par le bandeau de l'onglet Bases. */
export function dependencySummary(report: DependencyReport) {
  const parts = [];
  if (report.not_loaded.length) {
    parts.push(
      `${report.not_loaded.length} module${report.not_loaded.length > 1 ? "s" : ""} bloqué${report.not_loaded.length > 1 ? "s" : ""}`,
    );
  }
  if (report.missing.length) {
    parts.push(
      `${report.missing.length} module${report.missing.length > 1 ? "s" : ""} manquant${report.missing.length > 1 ? "s" : ""}`,
    );
  }
  return parts.join(" · ");
}

function ModuleChips({ names, tone }: { names: string[]; tone: "danger" | "neutral" }) {
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((name) => (
        <span
          key={name}
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-[11px]",
            tone === "danger"
              ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200"
              : "bg-muted text-muted-foreground",
          )}
        >
          {name}
        </span>
      ))}
    </span>
  );
}

export function DependenciesDialog({
  open,
  onOpenChange,
  database,
  report,
  loading,
  error,
  onRefresh,
  onImportRepository,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  database: string;
  report: DependencyReport | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onImportRepository: () => void;
  onCopy: (text: string) => void;
}) {
  const missingNames = report?.missing.map((module) => module.name) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Modules manquants de {database || "la base"}</DialogTitle>
          <DialogDescription>
            Certains modules utilisés par cette base ne sont pas dans le projet. Ajoute-les depuis leur dépôt Git pour
            que tout fonctionne.
          </DialogDescription>
        </DialogHeader>

        {!report ? (
          <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Vérification des modules de la base…
              </>
            ) : (
              error || "Impossible de vérifier les modules pour le moment."
            )}
          </div>
        ) : report.ok ? (
          <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-100">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            Rien ne manque : tous les modules de cette base sont présents dans le projet.
          </div>
        ) : (
          <div className="grid max-h-[60vh] gap-5 overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2">
              {report.not_loaded.length > 0 && (
                <Badge variant="danger">
                  {report.not_loaded.length} module{report.not_loaded.length > 1 ? "s" : ""} bloqué
                  {report.not_loaded.length > 1 ? "s" : ""}
                </Badge>
              )}
              <Badge variant="warning">
                {report.missing.length} module{report.missing.length > 1 ? "s" : ""} manquant
                {report.missing.length > 1 ? "s" : ""}
              </Badge>
            </div>

            {report.not_loaded.length > 0 && (
              <section className="grid gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <TriangleAlert className="h-4 w-4 text-destructive" />
                  Modules bloqués
                </h3>
                <p className="text-xs text-muted-foreground">
                  Ils sont bien dans le projet, mais Odoo ne peut pas les utiliser tant que les modules ci-dessous
                  manquent. Certains écrans d’Odoo affichent alors des erreurs.
                </p>
                <ul className="divide-y rounded-md border">
                  {report.not_loaded.map((module) => (
                    <li key={module.name} className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[minmax(0,18rem)_1fr]">
                      <span className={cn("break-all text-sm font-medium", REFINED_IDENTIFIER)}>{module.name}</span>
                      <span className="grid gap-1 text-xs text-muted-foreground">
                        <span className="flex flex-wrap items-center gap-1.5">
                          Il manque <ModuleChips names={module.root_causes} tone="danger" />
                        </span>
                        {module.blocked_by.some((name) => !module.root_causes.includes(name)) && (
                          <span className="flex flex-wrap items-center gap-1.5">
                            à cause de <ModuleChips names={module.blocked_by} tone="neutral" />
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {report.missing.length > 0 && (
              <section className="grid gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <PackageX className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Modules à ajouter au projet
                </h3>
                <ul className="divide-y rounded-md border">
                  {report.missing.map((module) => (
                    <li
                      key={module.name}
                      className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-center"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className={cn("break-all text-sm font-medium", REFINED_IDENTIFIER)}>{module.name}</span>
                        {module.reason !== "code absent" && <Badge variant="outline">désactivé dans le code</Badge>}
                        {module.excluded && <Badge variant="outline">exclu localement</Badge>}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {module.required_by.length ? (
                          <>
                            Nécessaire pour <ModuleChips names={module.required_by} tone="neutral" />
                          </>
                        ) : (
                          "Aucun autre module n’en a besoin."
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={loading} onClick={onRefresh}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Actualiser
          </Button>
          {missingNames.length > 0 && (
            <>
              <Button variant="outline" onClick={() => onCopy(missingNames.join("\n"))}>
                <Copy className="h-4 w-4" />
                Copier la liste
              </Button>
              <Button onClick={onImportRepository}>
                <GitBranch className="h-4 w-4" />
                Importer depuis un dépôt Git
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
