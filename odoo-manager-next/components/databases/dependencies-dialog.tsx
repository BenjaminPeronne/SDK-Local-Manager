"use client";

import { type ReactNode, useMemo } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CloudDownload,
  Copy,
  GitBranch,
  Loader2,
  PackageX,
  RefreshCcw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { isJobUnfinished } from "@/lib/jobs";
import {
  type ModuleSourceGroup,
  type ModuleSourcesPlan,
  moduleSourcesResult,
  planModuleSources,
  shortRepositoryLabel,
} from "@/lib/module-sources";
import type { DependencyReport, Job, ModuleSourcesResult } from "@/lib/types";
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

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        {title}
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 grid gap-1.5 text-xs text-muted-foreground">{children}</div>
    </details>
  );
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** Recherche des modules manquants dans les dépôts déjà utilisés par les projets, puis import groupé. */
function ModuleSourcesPanel({
  job,
  result,
  plan,
  total,
  importing,
  onSearch,
  onImport,
  onReview,
}: {
  job: Job | null;
  result: ModuleSourcesResult | null;
  plan: ModuleSourcesPlan | null;
  total: number;
  importing: boolean;
  onSearch: () => void;
  onImport: (groups: ModuleSourceGroup[]) => void;
  onReview: (group: ModuleSourceGroup) => void;
}) {
  const running = Boolean(job && isJobUnfinished(job));
  const done = job?.status === "done" && plan !== null;
  const failures = result?.failures ?? [];
  const missingBranch = result?.missing_branch ?? [];
  let status: ReactNode =
    "Cherche-les dans les dépôts GitLab déjà utilisés par tes projets : ceux qui y sont s’importent ensuite en un clic.";
  if (running) {
    status = (
      <>
        {job?.progress?.label || "Recherche en cours"}
        {job?.progress ? <span className="tabular-nums"> · {job.progress.percent} %</span> : null}. Tu peux fermer cette
        fenêtre, la recherche continue.
      </>
    );
  } else if (job?.status === "error") {
    status = <span className="text-destructive">{job.error_message || "La recherche a échoué."}</span>;
  } else if (job?.status === "cancelled") {
    status = "Recherche arrêtée. Relance-la quand tu veux.";
  } else if (done) {
    status = plan.found ? (
      <>
        <span className="font-medium text-foreground">
          {plan.found} des {plural(total, "module manquant", "modules manquants")}
        </span>{" "}
        {plan.found > 1 ? "sont" : "est"} dans {plural(plan.groups.length, "dépôt")} de tes projets.
      </>
    ) : (
      `Aucun de ces modules n’est dans les ${plural(result?.scanned ?? 0, "dépôt")} de tes projets.`
    );
  }

  return (
    <section className="grid gap-3 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Search className="h-4 w-4 text-muted-foreground" />
            Retrouver ces modules dans tes dépôts
          </h3>
          <p className="text-xs text-muted-foreground">{status}</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={running} onClick={onSearch}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {running ? "Recherche…" : job?.status === "done" ? "Relancer la recherche" : "Chercher dans mes dépôts"}
        </Button>
      </div>

      {done && plan.groups.length > 0 && (
        <>
          <ul className="divide-y rounded-md border bg-background">
            {plan.groups.map((group) => (
              <li
                key={`${group.repository.url}#${group.repository.branch}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
              >
                <span className="grid min-w-0 flex-1 gap-1.5">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium" title={group.repository.label}>
                      {shortRepositoryLabel(group.repository.label)}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{group.repository.branch}</span>
                    <span className="text-xs text-muted-foreground">· {plural(group.modules.length, "module")}</span>
                  </span>
                  <ModuleChips names={group.modules.map((module) => module.name)} tone="neutral" />
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => onReview(group)}>
                  Vérifier
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Un import par dépôt, l’un après l’autre. Si l’un échoue, ce dépôt n’est pas modifié et les autres
              continuent.
            </p>
            <Button type="button" className="shrink-0" disabled={importing} onClick={() => onImport(plan.groups)}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
              {plan.found > 1 ? `Importer les ${plan.found} modules` : "Importer le module"}
            </Button>
          </div>
        </>
      )}

      {done && (
        <div className="grid gap-2">
          {plan.unsearched.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {plan.unsearched.length > 1
                ? `${plan.unsearched.length} modules manquants ne faisaient pas partie de cette recherche : relance-la pour les inclure.`
                : "1 module manquant ne faisait pas partie de cette recherche : relance-la pour l’inclure."}
            </p>
          )}
          {plan.blocked.length > 0 && (
            <Disclosure title={`Trouvés mais impossibles à importer (${plan.blocked.length})`}>
              {plan.blocked.map((item) => (
                <span key={item.name}>
                  <span className={cn("font-medium text-foreground", REFINED_IDENTIFIER)}>{item.name}</span> (
                  {shortRepositoryLabel(item.repository.label)}) : {item.reason}
                </span>
              ))}
            </Disclosure>
          )}
          {plan.absent.length > 0 && (
            <Disclosure title={`Introuvables dans tes dépôts (${plan.absent.length})`}>
              <span>
                Si tu connais leur dépôt, ajoute-les avec « Importer depuis un dépôt Git », en bas de cette fenêtre.
              </span>
              <ModuleChips names={plan.absent} tone="neutral" />
            </Disclosure>
          )}
          {failures.length > 0 && (
            <Disclosure title={`Dépôts illisibles (${failures.length})`}>
              {failures.map((failure) => (
                <span key={failure.label}>
                  <span className="font-medium text-foreground">{shortRepositoryLabel(failure.label)}</span> (
                  {failure.branch}) : {failure.error}
                </span>
              ))}
            </Disclosure>
          )}
          {missingBranch.length > 0 && (
            <p className="text-xs text-muted-foreground" title={missingBranch.map(shortRepositoryLabel).join(", ")}>
              {missingBranch.length > 1
                ? `${missingBranch.length} dépôts n’ont pas de version pour Odoo ${result?.odoo_version} : ils ont été ignorés.`
                : `1 dépôt n’a pas de version pour Odoo ${result?.odoo_version} : il a été ignoré.`}
            </p>
          )}
        </div>
      )}
    </section>
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
  sourcesJob,
  importingSources,
  onSearchSources,
  onImportSources,
  onReviewSource,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  database: string;
  report: DependencyReport | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onImportRepository: (missing: string[]) => void;
  onCopy: (text: string) => void;
  /** Dernière recherche des modules dans les dépôts du projet, en cours ou terminée. */
  sourcesJob: Job | null;
  importingSources: boolean;
  onSearchSources: (missing: string[]) => void;
  onImportSources: (groups: ModuleSourceGroup[]) => void;
  onReviewSource: (group: ModuleSourceGroup) => void;
}) {
  const missingNames = useMemo(() => report?.missing.map((module) => module.name) ?? [], [report]);
  const sourcesResult = moduleSourcesResult(sourcesJob);
  const sourcesPlan = useMemo(
    () => (sourcesJob?.status === "done" && sourcesResult ? planModuleSources(sourcesResult, missingNames) : null),
    [missingNames, sourcesJob?.status, sourcesResult],
  );
  const sourceByModule = useMemo(
    () =>
      new Map(
        (sourcesPlan?.groups ?? []).flatMap((group) =>
          group.modules.map((module) => [module.name, group.repository] as const),
        ),
      ),
    [sourcesPlan],
  );

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

            {report.missing.length > 0 && (
              <ModuleSourcesPanel
                job={sourcesJob}
                result={sourcesResult}
                plan={sourcesPlan}
                total={report.missing.length}
                importing={importingSources}
                onSearch={() => onSearchSources(missingNames)}
                onImport={onImportSources}
                onReview={onReviewSource}
              />
            )}

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
                        {sourceByModule.has(module.name) && (
                          <Badge
                            variant="success"
                            title={`Trouvé dans ${sourceByModule.get(module.name)?.label} (${sourceByModule.get(module.name)?.branch})`}
                          >
                            {shortRepositoryLabel(sourceByModule.get(module.name)?.label ?? "")}
                          </Badge>
                        )}
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
              <Button onClick={() => onImportRepository(missingNames)}>
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
