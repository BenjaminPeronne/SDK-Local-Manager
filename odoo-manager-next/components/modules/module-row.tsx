"use client";

import { memo, type MouseEvent as ReactMouseEvent } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import { Languages, MoreHorizontal, PackageX, PlusCircle, RefreshCcw, Trash2, Undo2 } from "lucide-react";
import { compactWorkspacePath } from "@/lib/format";
import { moduleOriginLabel, normalizedModuleOrigin } from "@/lib/modules";
import type { ModuleInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { REFINED_IDENTIFIER, REFINED_MODULE_COLUMNS, REFINED_ROW_TITLE } from "@/components/common/refined-layout";
import { ModuleStateBadge } from "@/components/modules/module-badges";

export type ModuleRowActions = {
  canUseDb: boolean;
  installModule: (name: string) => void;
  updateModule: (name: string) => void;
  requestDeleteCode: (moduleNames: string[]) => void;
  requestTranslationReset: (moduleNames: string[]) => void;
  requestUninstall: (moduleNames: string[]) => void;
  restoreRepositoryVersion: (name: string) => void;
  toggleFromRow: (event: ReactMouseEvent<HTMLElement>, name: string) => void;
  toggleSelection: (name: string, checked: boolean) => void;
};

type ModuleRowProps = {
  actions: ModuleRowActions;
  module: ModuleInfo;
  /** Dépôt remplacé déjà affiché dans l'en-tête du groupe : la ligne ne le répète pas. */
  replacedShownAbove?: string;
  selected: boolean;
  showLocations: boolean;
  workspace?: string;
};

/** Ligne d'un module : sélection, état, version, origine et actions sur la base de travail. */
export const ModuleRow = memo(function ModuleRow({
  actions,
  module,
  replacedShownAbove,
  selected,
  showLocations,
  workspace,
}: ModuleRowProps) {
  const sourcePath = module.source_path || module.path;
  const linkPath = module.link_path || (module.path_kind?.startsWith("lien") ? module.path : "");
  const displaySourcePath = compactWorkspacePath(sourcePath, workspace);
  const displayLinkPath = compactWorkspacePath(linkPath, workspace);
  const samePaths = Boolean(linkPath && sourcePath && linkPath === sourcePath);
  const origin = normalizedModuleOrigin(module.origin, sourcePath);
  const moduleTitle = module.title || module.name;
  const showTechnicalName = moduleTitle !== module.name;
  const showReplaced = Boolean(module.replaced_repository && module.replaced_repository !== replacedShownAbove);
  return (
    <div
      className={cn(
        "grid min-w-0 cursor-pointer gap-3 border-t p-3 transition-colors first:border-t-0 xl:items-center",
        REFINED_MODULE_COLUMNS,
        selected ? "bg-selected" : "hover:bg-hover",
      )}
      onClick={(event) => actions.toggleFromRow(event, module.name)}
    >
      <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
        <Checkbox
          className="mt-1"
          aria-label={`Sélectionner ${module.name}`}
          checked={selected}
          onCheckedChange={(checked) => actions.toggleSelection(module.name, checked === true)}
        />
        <span className="min-w-0">
          {/* Badges en flex : renvoyés à la ligne, ils restent alignés sur le début du nom. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "min-w-0",
                showTechnicalName ? cn("break-words", REFINED_ROW_TITLE) : cn("break-all", REFINED_IDENTIFIER),
              )}
            >
              {moduleTitle}
            </span>
            {module.application && (
              <Badge variant="outline" className="shrink-0">
                Application
              </Badge>
            )}
            {showReplaced && (
              <Badge
                variant="warning"
                className="shrink-0 cursor-help"
                title={`Copie importée à la place de la version de ${module.replaced_repository}, qui reste en place : « Revenir à la version du dépôt », dans le menu ⋯, la rétablit.`}
              >
                Remplace un dépôt
              </Badge>
            )}
          </span>
          {showTechnicalName && (
            <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">{module.name}</span>
          )}
          {showLocations && (
            <span className="mt-1.5 block space-y-0.5 text-xs">
              {module.path_kind && <span className="block text-muted-foreground">{module.path_kind}</span>}
              <span className="block truncate font-mono text-teal-700 dark:text-teal-300" title={sourcePath}>
                {displaySourcePath || "-"}
              </span>
              {displayLinkPath && !samePaths && (
                <span className="block truncate font-mono text-blue-700 dark:text-blue-300" title={linkPath}>
                  {displayLinkPath}
                </span>
              )}
            </span>
          )}
        </span>
      </label>
      <div className="flex min-w-0 items-center justify-between gap-3 xl:block">
        <span className="text-xs font-medium text-muted-foreground xl:hidden">État</span>
        <ModuleStateBadge state={module.state} />
      </div>
      <div className="flex min-w-0 items-start justify-between gap-3 xl:block">
        <span className="text-xs font-medium text-muted-foreground xl:hidden">Version</span>
        <span className="min-w-0 break-all font-mono text-xs tabular-nums">
          {module.installed_version || module.version || "-"}
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 xl:block">
        <span className="text-xs font-medium text-muted-foreground xl:hidden">Origine</span>
        <Badge className="shrink-0" variant="outline">
          {moduleOriginLabel(origin)}
        </Badge>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        {module.state === "installed" ? (
          <Button
            className="w-full"
            size="sm"
            variant="accent"
            disabled={!actions.canUseDb}
            onClick={() => actions.updateModule(module.name)}
          >
            <RefreshCcw className="h-4 w-4" />
            Mettre à jour
          </Button>
        ) : (
          <Button
            className="w-full"
            size="sm"
            variant="success"
            disabled={!actions.canUseDb}
            onClick={() => actions.installModule(module.name)}
          >
            <PlusCircle className="h-4 w-4" />
            Installer
          </Button>
        )}
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              title={`Autres actions pour ${module.name}`}
              aria-label={`Autres actions pour ${module.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" className="min-w-52">
            <DropdownMenu.Label>Actions sur {module.name}</DropdownMenu.Label>
            {module.state === "installed" && (
              <DropdownMenu.Item
                disabled={!actions.canUseDb}
                onSelect={() => actions.requestTranslationReset([module.name])}
              >
                <Languages className="h-4 w-4" />
                Réinitialiser les traductions
              </DropdownMenu.Item>
            )}
            {module.state === "installed" && (
              <DropdownMenu.Item
                color="red"
                disabled={!actions.canUseDb}
                onSelect={() => actions.requestUninstall([module.name])}
              >
                <PackageX className="h-4 w-4" />
                Désinstaller de la base
              </DropdownMenu.Item>
            )}
            {module.replaced_repository && (
              <DropdownMenu.Item onSelect={() => actions.restoreRepositoryVersion(module.name)}>
                <Undo2 className="h-4 w-4" />
                Revenir à la version du dépôt {module.replaced_repository}
              </DropdownMenu.Item>
            )}
            {module.removal_mode !== "link_only" && (
              <DropdownMenu.Item
                color="red"
                disabled={!module.removable}
                onSelect={() => actions.requestDeleteCode([module.name])}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer du projet
              </DropdownMenu.Item>
            )}
            {module.state !== "installed" && module.removal_mode === "link_only" && (
              <DropdownMenu.Item disabled>Module protégé</DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </div>
  );
});
