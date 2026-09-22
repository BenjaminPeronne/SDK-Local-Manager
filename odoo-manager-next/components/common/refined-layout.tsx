import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// Interface affinée : vocabulaire commun aux écrans Bases, Modules, Activité et Réglages.
export const REFINED_FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Échelle typographique : le nom du projet reste le niveau 1 (24-30px/600), le titre d'écran
// devient le niveau 2, et le contenu descend à 14px comme le reste de l'application.
const REFINED_SECTION_TITLE = "text-lg font-semibold leading-tight tracking-[-0.01em]";

export const REFINED_ROW_TITLE = "text-sm font-medium";

export const REFINED_LABEL = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

// Identifiants techniques en JetBrains Mono : chiffres alignés et 0/O, 1/l non ambigus.
export const REFINED_IDENTIFIER = "font-mono text-[0.8125rem] font-medium tracking-tight";

// Les emplacements techniques passent sous le nom du module : la ligne n'a plus de colonne large dédiée.
// Chaque ligne est sa propre grille : toutes les colonnes sauf le nom ont une largeur fixe, sinon la
// largeur du bouton d'action ("Installer" / "Mettre à jour") décalerait les colonnes d'une ligne à l'autre.
export const REFINED_MODULE_COLUMNS = "xl:grid-cols-[minmax(0,1fr)_120px_110px_150px_200px]";

export function RefinedSectionHeader({
  title,
  count,
  description,
  actions,
}: {
  title: string;
  count?: number;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className={cn("min-w-0", REFINED_SECTION_TITLE)}>{title}</h3>
          {typeof count === "number" && (
            <Badge className="shrink-0 tabular-nums" variant="outline">
              {count}
            </Badge>
          )}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function RefinedPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-md border bg-card", className)} {...props} />;
}

export function RefinedRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-4 p-4", className)}>
      <div className="min-w-0">
        <div className={REFINED_ROW_TITLE}>{title}</div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
