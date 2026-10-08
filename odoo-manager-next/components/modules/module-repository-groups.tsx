"use client";

import { type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction, useState } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import {
  ChevronRight,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  MoreHorizontal,
  Package,
  Tag,
  Undo2,
} from "lucide-react";
import {
  type ModuleRepositoryGroup,
  repositoryBranchSwitchable,
  repositoryRevision,
  sharedReplacedRepository,
} from "@/lib/module-repositories";
import type { Job, ModuleRepository } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ModuleRow, type ModuleRowActions } from "@/components/modules/module-row";
import { RepositoryBranchPicker } from "@/components/modules/repository-branch-picker";

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
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  folding: RepositoryFolding;
  groups: ModuleRepositoryGroup[];
  onFold: (groupId: string, expanded: boolean) => void;
  openUrl: (url?: string) => Promise<void>;
  projectName?: string;
  rowActions: ModuleRowActions;
  /** Recherche en cours : tous les dépôts qui ont des résultats s'ouvrent. */
  searchActive: boolean;
  selectedModules: Set<string>;
  setSelectedModules: Dispatch<SetStateAction<Set<string>>>;
  showLocations: boolean;
  /** Hauteur occupée au-dessus de la liste (en-têtes du projet et du tableau) : l'en-tête de dépôt s'y colle. */
  stickyTop: number;
  workspace?: string;
};

/** Modules regroupés par dépôt d'origine, chaque dépôt avec sa branche et son adresse. */
export function ModuleRepositoryGroups({
  createJob,
  folding,
  groups,
  onFold,
  openUrl,
  projectName,
  rowActions,
  searchActive,
  selectedModules,
  setSelectedModules,
  showLocations,
  stickyTop,
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
        const replaced = sharedReplacedRepository(group.modules);
        const replacing = replaced
          ? group.modules.filter((module) => module.replaced_repository === replaced.label).map((module) => module.name)
          : [];
        const switchable = Boolean(repository && projectName && repositoryBranchSwitchable(repository));
        // Tout l'en-tête plie le dépôt, sauf ses contrôles (et le sélecteur de branche, rendu en portail).
        const foldFromHeader = (event: ReactMouseEvent<HTMLElement>) => {
          const target = event.target as HTMLElement;
          if (target.closest("button, a, input, label, [role=dialog], [role=menu]")) return;
          if (window.getSelection()?.toString()) return;
          onFold(group.id, !expanded);
        };
        return (
          <section key={group.id || "none"} className="border-t first:border-t-0" aria-label={`Dépôt ${name}`}>
            {/* Collé en haut tant que ses modules défilent : on sait toujours dans quel dépôt on est.
                Fond opaque sous la teinte, sinon les lignes resteraient visibles à travers. */}
            <div className="sticky z-[5] bg-card" style={{ top: stickyTop }}>
              <div
                className="flex min-w-0 cursor-pointer items-start gap-3 bg-muted/40 px-3 py-2.5"
                onClick={foldFromHeader}
              >
                <Checkbox
                  className="mt-1"
                  aria-label={`Sélectionner les modules de ${name}`}
                  checked={
                    selectedCount === 0 ? false : selectedCount === group.modules.length ? true : "indeterminate"
                  }
                  onCheckedChange={(checked) => toggleGroupSelection(group, checked === true)}
                />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={expanded}
                      aria-controls={contentId}
                      onClick={() => onFold(group.id, !expanded)}
                    >
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
                    </button>
                    {repository &&
                      (switchable && projectName ? (
                        <RepositoryBranchPicker
                          createJob={createJob}
                          moduleCount={group.modules.length}
                          projectName={projectName}
                          repository={repository}
                        />
                      ) : (
                        <RevisionBadge repository={repository} />
                      ))}
                    {replaced && (
                      <Badge
                        variant="warning"
                        className="max-w-full shrink-0"
                        title={`Copies importées à la place de la version de ${replaced.label}, qui reste en place : « Revenir à la version du dépôt », dans le menu d’un module, la rétablit.`}
                      >
                        <span className="truncate">
                          {replaced.count === group.modules.length
                            ? `Remplace ${replaced.label}`
                            : `${replaced.count} remplacent ${replaced.label}`}
                        </span>
                      </Badge>
                    )}
                  </div>
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
                </div>
                <span className="shrink-0 whitespace-nowrap pt-1 text-xs tabular-nums text-muted-foreground">
                  {group.modules.length} module{group.modules.length > 1 ? "s" : ""} · {group.installed} installé
                  {group.installed > 1 ? "s" : ""}
                </span>
                {webUrl && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    title={`Ouvrir ${repository?.remote_label} dans le navigateur`}
                    aria-label={`Ouvrir le dépôt ${name} dans le navigateur`}
                    onClick={() => void openUrl(webUrl)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                )}
                {replaced && (
                  <DropdownMenu.Root modal={false}>
                    <DropdownMenu.Trigger>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        title={`Autres actions pour ${name}`}
                        aria-label={`Autres actions pour le dépôt ${name}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" className="min-w-64">
                      <DropdownMenu.Label>Dépôt {name}</DropdownMenu.Label>
                      <DropdownMenu.Item onSelect={() => rowActions.restoreRepositoryVersions(replacing)}>
                        <Undo2 className="h-4 w-4" />
                        Revenir à la version de {replaced.label} ({replacing.length} module
                        {replacing.length > 1 ? "s" : ""})
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                )}
              </div>
            </div>
            {expanded && (
              <div id={contentId} className="min-w-0 border-t">
                {group.modules.slice(0, limit).map((module) => (
                  <ModuleRow
                    key={module.name}
                    actions={rowActions}
                    module={module}
                    selected={selectedModules.has(module.name)}
                    replacedShownAbove={replaced?.label}
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
