"use client";

import { type Dispatch, type SetStateAction, useState } from "react";
import {
  ChevronRight,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Package,
  Tag,
} from "lucide-react";
import { type ModuleRepositoryGroup, repositoryRevision } from "@/lib/module-repositories";
import type { ModuleRepository } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ModuleRow, type ModuleRowActions } from "@/components/modules/module-row";

// Au-delà, un dépôt s'ouvre replié : Odoo et Enterprise comptent des centaines de modules.
const EXPANDED_GROUP_MAX_MODULES = 40;

/** Dépôts ouverts ou fermés à la main ; les autres suivent groupExpanded. */
export type RepositoryFolding = Record<string, boolean>;

/** Ouvert par défaut : petit dépôt, ou recherche en cours (ses résultats se voient). */
export function groupExpanded(group: ModuleRepositoryGroup, folding: RepositoryFolding, searchActive: boolean) {
  return folding[group.id] ?? (searchActive || group.modules.length <= EXPANDED_GROUP_MAX_MODULES);
}
// Lignes affichées à l'ouverture d'un dépôt, puis par clic sur « Afficher plus ».
const GROUP_ROWS_STEP = 50;

const SOURCE_DETAILS: Record<ModuleRepository["source"], { label: string; title: string } | null> = {
  git: null,
  sdk: {
    label: "Archive SDK",
    title:
      "Téléchargé depuis la plateforme SDK, sans historique Git : branche et commit viennent de son fichier info.sdk.",
  },
  import: {
    label: "Copie importée",
    title: "Modules copiés depuis ce dépôt par « Ajouter des modules » : ils ne suivent plus la branche.",
  },
  odoo: { label: "Code d'Odoo", title: "Code source d'Odoo du projet, sans dépôt Git." },
};

/** Page web du dépôt, déduite de son adresse : gitlab.sudokeys.com/OCA/pos → https://gitlab.sudokeys.com/OCA/pos. */
function repositoryWebUrl(repository: ModuleRepository) {
  return repository.remote_label.includes("/") ? `https://${repository.remote_label}` : "";
}

function RevisionBadge({ repository }: { repository: ModuleRepository }) {
  const revision = repositoryRevision(repository);
  if (!revision) return null;
  const Icon = revision.kind === "branch" ? GitBranch : revision.kind === "tag" ? Tag : GitCommitHorizontal;
  const titles = { branch: "Branche", tag: "Étiquette", commit: "Commit" };
  return (
    <Badge
      variant="outline"
      className="max-w-full shrink-0 gap-1 font-mono"
      title={[`${titles[revision.kind]} ${revision.label}`, repository.commit && `commit ${repository.commit}`]
        .filter(Boolean)
        .join(" · ")}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{revision.label}</span>
    </Badge>
  );
}

type ModuleRepositoryGroupsProps = {
  folding: RepositoryFolding;
  groups: ModuleRepositoryGroup[];
  onFold: (groupId: string, expanded: boolean) => void;
  openUrl: (url?: string) => Promise<void>;
  rowActions: ModuleRowActions;
  /** Recherche en cours : tous les dépôts qui ont des résultats s'ouvrent. */
  searchActive: boolean;
  selectedModules: Set<string>;
  setSelectedModules: Dispatch<SetStateAction<Set<string>>>;
  showLocations: boolean;
  workspace?: string;
};

/** Modules regroupés par dépôt d'origine, chaque dépôt avec sa branche et son adresse. */
export function ModuleRepositoryGroups({
  folding,
  groups,
  onFold,
  openUrl,
  rowActions,
  searchActive,
  selectedModules,
  setSelectedModules,
  showLocations,
  workspace,
}: ModuleRepositoryGroupsProps) {
  const [visibleRows, setVisibleRows] = useState<Record<string, number>>({});

  function toggleGroupSelection(group: ModuleRepositoryGroup, checked: boolean) {
    setSelectedModules((current) => {
      const next = new Set(current);
      for (const item of group.modules) {
        if (checked) next.add(item.name);
        else next.delete(item.name);
      }
      return next;
    });
  }

  return (
    <div className="min-w-0">
      {groups.map((group) => {
        const repository = group.repository;
        const expanded = groupExpanded(group, folding, searchActive);
        const selectedCount = group.modules.filter((module) => selectedModules.has(module.name)).length;
        const limit = visibleRows[group.id] ?? GROUP_ROWS_STEP;
        const remaining = group.modules.length - limit;
        const name = repository?.name ?? "Sans dépôt connu";
        const details = repository ? SOURCE_DETAILS[repository.source] : null;
        const webUrl = repository ? repositoryWebUrl(repository) : "";
        const contentId = `module-repository-${group.id || "none"}`;
        const Icon = !repository ? FolderOpen : repository.source === "odoo" ? Package : FolderGit2;
        return (
          <section key={group.id || "none"} className="border-t first:border-t-0" aria-label={`Dépôt ${name}`}>
            <div className="flex min-w-0 items-start gap-3 bg-muted/40 px-3 py-2.5">
              <Checkbox
                className="mt-0.5"
                aria-label={`Sélectionner les modules de ${name}`}
                checked={selectedCount === 0 ? false : selectedCount === group.modules.length ? true : "indeterminate"}
                onCheckedChange={(checked) => toggleGroupSelection(group, checked === true)}
              />
              <button
                type="button"
                className="grid min-w-0 flex-1 gap-0.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={() => onFold(group.id, !expanded)}
              >
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                      expanded && "rotate-90",
                    )}
                    aria-hidden="true"
                  />
                  <Icon
                    className={cn("h-4 w-4 shrink-0", repository ? "text-primary" : "text-muted-foreground")}
                    aria-hidden="true"
                  />
                  <span className={cn("min-w-0 break-all font-semibold", !repository && "text-muted-foreground")}>
                    {name}
                  </span>
                  {repository && <RevisionBadge repository={repository} />}
                </span>
                {/* Aligné sur le nom : chevron (16 px) + écart (8) + icône (16) + écart (8). */}
                <span className="block truncate pl-12 text-xs text-muted-foreground" title={repository?.remote}>
                  {repository ? (
                    <>
                      {details && (
                        <span title={details.title}>
                          {details.label}
                          {repository.imported_at ? ` le ${repository.imported_at}` : ""}
                          {repository.remote_label ? " · " : ""}
                        </span>
                      )}
                      {repository.remote_label && <span className="font-mono">{repository.remote_label}</span>}
                    </>
                  ) : (
                    "Copies ajoutées à la main, depuis un ZIP ou un dossier"
                  )}
                </span>
              </button>
              {webUrl && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="-my-1 h-7 w-7 shrink-0"
                  title={`Ouvrir ${repository?.remote_label} dans le navigateur`}
                  aria-label={`Ouvrir le dépôt ${name} dans le navigateur`}
                  onClick={() => void openUrl(webUrl)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
              <span className="shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">
                {group.modules.length} module{group.modules.length > 1 ? "s" : ""}
                <span className="block">
                  {group.installed} installé{group.installed > 1 ? "s" : ""}
                </span>
              </span>
            </div>
            {expanded && (
              <div id={contentId} className="min-w-0 border-t">
                {group.modules.slice(0, limit).map((module) => (
                  <ModuleRow
                    key={module.name}
                    actions={rowActions}
                    module={module}
                    selected={selectedModules.has(module.name)}
                    showLocations={showLocations}
                    workspace={workspace}
                  />
                ))}
                {remaining > 0 && (
                  <div className="border-t px-3 py-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setVisibleRows((current) => ({ ...current, [group.id]: limit + GROUP_ROWS_STEP }))}
                    >
                      Afficher {Math.min(remaining, GROUP_ROWS_STEP)} de plus ({remaining} restant
                      {remaining > 1 ? "s" : ""})
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
