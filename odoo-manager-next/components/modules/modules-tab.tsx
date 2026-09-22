"use client";

import {
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
} from "react";
import { DropdownMenu } from "@radix-ui/themes";
import {
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  FileArchive,
  Languages,
  Loader2,
  MoreHorizontal,
  PackageX,
  PlusCircle,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";
import { type ModuleFilters, MODULES_PER_PAGE } from "@/hooks/use-module-filters";
import { compactWorkspacePath } from "@/lib/format";
import { moduleOriginLabel, normalizedModuleOrigin } from "@/lib/modules";
import type { Job, ManagerSettings, ModuleInfo, Overview, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import {
  REFINED_IDENTIFIER,
  REFINED_LABEL,
  REFINED_MODULE_COLUMNS,
  REFINED_ROW_TITLE,
  RefinedPanel,
  RefinedSectionHeader,
} from "@/components/common/refined-layout";
import { ModuleStateBadge } from "@/components/modules/module-badges";

type ModulesTabProps = {
  canUseDb: boolean;
  checkingUpdatePrerequisites: boolean;
  chooseDatabase: (db: string, projectName?: string | undefined) => void;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  loadingModules: boolean;
  moduleFilters: ModuleFilters;
  modules: ModuleInfo[];
  moduleSelectionBlock: ReactNode;
  odooDatabases: string[];
  openRepositoryImport: () => void;
  openSocleDialog: () => void;
  openZipImport: () => void;
  overview: Overview | null;
  projectHeaderHeight: number;
  projectTabsHeight: number;
  refinedInterface: boolean;
  refreshModules: () => Promise<void>;
  requestDeleteCode: (moduleNames: string[]) => void;
  requestTranslationReset: (moduleNames: string[]) => void;
  requestUninstall: (moduleNames: string[]) => void;
  requestUpdateAllOdooModules: () => Promise<void>;
  selectedDb: string;
  selectedModules: Set<string>;
  selectedProject: Project | undefined;
  selectedProjectReady: boolean;
  setSelectedModules: Dispatch<SetStateAction<Set<string>>>;
  settings: ManagerSettings | null;
  stickyHeader: boolean;
};

export function ModulesTab({
  canUseDb,
  checkingUpdatePrerequisites,
  chooseDatabase,
  createJob,
  loading,
  loadingModules,
  moduleFilters,
  modules,
  moduleSelectionBlock,
  odooDatabases,
  openRepositoryImport,
  openSocleDialog,
  openZipImport,
  overview,
  projectHeaderHeight,
  projectTabsHeight,
  refinedInterface,
  refreshModules,
  requestDeleteCode,
  requestTranslationReset,
  requestUninstall,
  requestUpdateAllOdooModules,
  selectedDb,
  selectedModules,
  selectedProject,
  selectedProjectReady,
  setSelectedModules,
  settings,
  stickyHeader,
}: ModulesTabProps) {
  const showModuleLocations = settings?.show_technical_details ?? false;
  const moduleTableGridColumns = showModuleLocations
    ? "xl:grid-cols-[minmax(210px,1.35fr)_100px_110px_150px_minmax(220px,1.15fr)_200px]"
    : "xl:grid-cols-[minmax(210px,1.35fr)_100px_110px_150px_200px]";
  const toggleModuleSelection = useCallback((name: string, checked: boolean) => {
    setSelectedModules((current) => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);
  const toggleModuleFromRow = useCallback((event: ReactMouseEvent<HTMLElement>, name: string) => {
    const target = event.target as HTMLElement;
    // Les contrôles gardent leur action, y compris les menus rendus en portail dont les clics remontent jusqu'ici.
    if (target.closest("button, a, input, select, textarea, label, [role=menu], [role=menuitem], [role=dialog]"))
      return;
    // Sélectionner un nom ou un chemin pour le copier ne coche pas la ligne.
    if (window.getSelection()?.toString()) return;
    setSelectedModules((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }, []);
  // Filtres et sélection des modules : identiques en affichage classique et affiné.
  const moduleFiltersBlock = (
    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_210px_220px]">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Rechercher par nom de module"
          value={moduleFilters.search}
          onChange={(event) => moduleFilters.setSearch(event.target.value)}
        />
      </div>
      <Select value={moduleFilters.status} onValueChange={moduleFilters.setStatus}>
        <SelectTrigger placeholder="État">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les états</SelectItem>
          <SelectItem value="installed">Installés</SelectItem>
          <SelectItem value="uninstalled">Disponibles</SelectItem>
          <SelectItem value="to upgrade">À mettre à jour</SelectItem>
        </SelectContent>
      </Select>
      <Select value={moduleFilters.origin} onValueChange={moduleFilters.setOrigin}>
        <SelectTrigger placeholder="Origine">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les origines</SelectItem>
          <SelectItem value="enterprise">Odoo Enterprise</SelectItem>
          <SelectItem value="other">Autre</SelectItem>
        </SelectContent>
      </Select>
      <Select value={selectedDb} onValueChange={(db) => chooseDatabase(db)}>
        <SelectTrigger placeholder="Base Odoo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {odooDatabases.map((db) => (
            <SelectItem key={db} value={db}>
              {db}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const modulePaginationBlock = moduleFilters.filtered.length > 0 && (
    <div className="flex flex-col gap-3 border-t bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-muted-foreground">
        {Math.min((moduleFilters.page - 1) * MODULES_PER_PAGE + 1, moduleFilters.filtered.length)}–
        {Math.min(moduleFilters.page * MODULES_PER_PAGE, moduleFilters.filtered.length)} sur{" "}
        {moduleFilters.filtered.length} module(s)
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          disabled={moduleFilters.page <= 1}
          onClick={() => moduleFilters.setPage((page) => Math.max(1, page - 1))}
          aria-label="Page précédente"
          title="Page précédente"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-20 text-center tabular-nums">
          Page {moduleFilters.page}/{moduleFilters.pageCount}
        </span>
        <Button
          size="icon"
          variant="outline"
          disabled={moduleFilters.page >= moduleFilters.pageCount}
          onClick={() => moduleFilters.setPage((page) => Math.min(moduleFilters.pageCount, page + 1))}
          aria-label="Page suivante"
          title="Page suivante"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
  const moduleEmptyState = (
    <div className="grid justify-items-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <span>
        {loadingModules
          ? "Lecture des modules du projet…"
          : modules.length
            ? "Aucun module ne correspond aux filtres actuels."
            : "Aucun module Odoo n’a été détecté dans les dossiers addons du projet."}
      </span>
      {!loadingModules && moduleFilters.active && (
        <Button type="button" size="sm" variant="outline" onClick={moduleFilters.reset}>
          Réinitialiser les filtres
        </Button>
      )}
    </div>
  );

  return (
    <TabsContent value="modules">
      {refinedInterface ? (
        <div className="space-y-4">
          <RefinedSectionHeader
            title="Modules"
            count={moduleFilters.filtered.length}
            description="Les actions s’appliquent à la base de travail sélectionnée."
            actions={
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => void refreshModules()}
                  disabled={loadingModules}
                  aria-label="Actualiser la liste des modules"
                  title="Actualiser la liste des modules"
                >
                  <RefreshCcw className={cn("h-4 w-4", loadingModules && "animate-spin")} />
                </Button>
                {/* Les imports de code sont regroupés : ils mènent tous à « ajouter des modules au projet ».
                    Menus non modaux : le verrou de défilement de Radix détache l'en-tête et la barre latérale collés. */}
                <DropdownMenu.Root modal={false}>
                  <DropdownMenu.Trigger>
                    <Button variant="outline" disabled={!selectedProjectReady}>
                      <PlusCircle className="h-4 w-4" />
                      Ajouter des modules
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" className="min-w-64">
                    <DropdownMenu.Item disabled={loading} onSelect={openRepositoryImport}>
                      <CloudDownload className="h-4 w-4" />
                      Depuis un dépôt Git (SSH)
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={openZipImport}>
                      <FileArchive className="h-4 w-4" />
                      Depuis un pauvre zip
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
                <Button variant="outline" onClick={openSocleDialog} disabled={!selectedProjectReady || loading}>
                  <Boxes className="h-4 w-4" />
                  Installer un socle
                </Button>
                <Button
                  disabled={!selectedProjectReady || loading || checkingUpdatePrerequisites}
                  onClick={requestUpdateAllOdooModules}
                >
                  {checkingUpdatePrerequisites ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  MAJ complète Odoo
                </Button>
              </>
            }
          />
          {moduleFiltersBlock}
          {moduleSelectionBlock}
          {/* overflow-clip arrondit les coins sans créer de conteneur de défilement, contrairement à
              overflow-hidden qui empêcherait l'en-tête de rester collé. L'en-tête reste donc un bandeau droit :
              des coins arrondis collés en haut laisseraient voir les lignes qui défilent derrière. */}
          <RefinedPanel className="overflow-clip">
            <div
              className="z-10 hidden border-b bg-card xl:sticky xl:block"
              style={{ top: stickyHeader ? projectHeaderHeight + projectTabsHeight : 0 }}
            >
              <div
                className={cn("grid items-center gap-3 bg-muted/60 px-3 py-2", REFINED_LABEL, REFINED_MODULE_COLUMNS)}
              >
                <div>Module</div>
                <div>État</div>
                <div>Version</div>
                <div>Origine</div>
                <div className="text-right">Actions</div>
              </div>
            </div>
            <div className="min-w-0">
              {moduleFilters.visible.length
                ? moduleFilters.visible.map((module) => {
                    const sourcePath = module.source_path || module.path;
                    const linkPath = module.link_path || (module.path_kind?.startsWith("lien") ? module.path : "");
                    const displaySourcePath = compactWorkspacePath(sourcePath, overview?.workspace);
                    const displayLinkPath = compactWorkspacePath(linkPath, overview?.workspace);
                    const samePaths = Boolean(linkPath && sourcePath && linkPath === sourcePath);
                    const origin = normalizedModuleOrigin(module.origin, sourcePath);
                    const moduleTitle = module.title || module.name;
                    const showTechnicalName = moduleTitle !== module.name;
                    const moduleSelected = selectedModules.has(module.name);
                    return (
                      <div
                        key={module.name}
                        className={cn(
                          "grid min-w-0 cursor-pointer gap-3 border-t p-3 transition-colors first:border-t-0 xl:items-center",
                          REFINED_MODULE_COLUMNS,
                          moduleSelected ? "bg-selected" : "hover:bg-hover",
                        )}
                        onClick={(event) => toggleModuleFromRow(event, module.name)}
                      >
                        <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                          <Checkbox
                            className="mt-1"
                            aria-label={`Sélectionner ${module.name}`}
                            checked={moduleSelected}
                            onCheckedChange={(checked) => toggleModuleSelection(module.name, checked === true)}
                          />
                          <span className="min-w-0">
                            <span
                              className={cn(
                                "block",
                                showTechnicalName
                                  ? cn("break-words", REFINED_ROW_TITLE)
                                  : cn("break-all", REFINED_IDENTIFIER),
                              )}
                            >
                              {moduleTitle}
                            </span>
                            {showTechnicalName && (
                              <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">
                                {module.name}
                              </span>
                            )}
                            {showModuleLocations && (
                              <span className="mt-1.5 block space-y-0.5 text-xs">
                                {module.path_kind && (
                                  <span className="block text-muted-foreground">{module.path_kind}</span>
                                )}
                                <span
                                  className="block truncate font-mono text-teal-700 dark:text-teal-300"
                                  title={sourcePath}
                                >
                                  {displaySourcePath || "-"}
                                </span>
                                {displayLinkPath && !samePaths && (
                                  <span
                                    className="block truncate font-mono text-blue-700 dark:text-blue-300"
                                    title={linkPath}
                                  >
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
                              disabled={!canUseDb}
                              onClick={() =>
                                createJob("update_module", {
                                  project: selectedProject?.name,
                                  db: selectedDb,
                                  modules: module.name,
                                })
                              }
                            >
                              <RefreshCcw className="h-4 w-4" />
                              Mettre à jour
                            </Button>
                          ) : (
                            <Button
                              className="w-full"
                              size="sm"
                              variant="success"
                              disabled={!canUseDb}
                              onClick={() =>
                                createJob("install_module", {
                                  project: selectedProject?.name,
                                  db: selectedDb,
                                  modules: module.name,
                                })
                              }
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
                                  disabled={!canUseDb}
                                  onSelect={() => requestTranslationReset([module.name])}
                                >
                                  <Languages className="h-4 w-4" />
                                  Réinitialiser les traductions
                                </DropdownMenu.Item>
                              )}
                              {module.state === "installed" && (
                                <DropdownMenu.Item
                                  color="red"
                                  disabled={!canUseDb}
                                  onSelect={() => requestUninstall([module.name])}
                                >
                                  <PackageX className="h-4 w-4" />
                                  Désinstaller de la base
                                </DropdownMenu.Item>
                              )}
                              {module.removal_mode !== "link_only" && (
                                <DropdownMenu.Item
                                  color="red"
                                  disabled={!module.removable}
                                  onSelect={() => requestDeleteCode([module.name])}
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
                  })
                : moduleEmptyState}
            </div>
            {modulePaginationBlock}
          </RefinedPanel>
        </div>
      ) : (
        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle>Modules</CardTitle>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => void refreshModules()}
                  disabled={loadingModules}
                  aria-label="Actualiser la liste des modules"
                  title="Actualiser la liste des modules"
                >
                  <RefreshCcw className={cn("h-4 w-4", loadingModules && "animate-spin")} />
                </Button>
              </div>
              <CardDescription>
                Recherche, sélection et mise à jour des modules de la base Odoo choisie.
              </CardDescription>
            </div>
            <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
              <Button
                className="w-full"
                variant="outline"
                onClick={openSocleDialog}
                disabled={!selectedProjectReady || loading}
              >
                <Boxes className="h-4 w-4" />
                Installer un socle
              </Button>
              <Button
                className="w-full"
                disabled={!selectedProjectReady || loading || checkingUpdatePrerequisites}
                onClick={requestUpdateAllOdooModules}
              >
                {checkingUpdatePrerequisites ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
                MAJ complète Odoo
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={openRepositoryImport}
                disabled={!selectedProjectReady || loading}
              >
                <CloudDownload className="h-4 w-4" />
                Dépôt SSH · Ajout / MAJ
              </Button>
              <Button className="w-full" variant="outline" onClick={openZipImport} disabled={!selectedProjectReady}>
                <FileArchive className="h-4 w-4" />
                Ajouter un pauvre zip
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">{moduleFiltersBlock}</div>
            <div className="mb-3 space-y-3">{moduleSelectionBlock}</div>
            <div className="overflow-hidden rounded-md border">
              <div
                className={cn(
                  "hidden border-b bg-muted px-3 py-2 text-xs font-medium uppercase text-muted-foreground xl:grid xl:items-center xl:gap-3",
                  moduleTableGridColumns,
                )}
              >
                <div>Module</div>
                <div>État</div>
                <div>Version</div>
                <div>Origine</div>
                {showModuleLocations && <div>Emplacements</div>}
                <div className="text-right">Actions</div>
              </div>
              <div className="max-h-[min(62vh,720px)] min-w-0 overflow-y-auto">
                {moduleFilters.visible.length
                  ? moduleFilters.visible.map((module) => {
                      const sourcePath = module.source_path || module.path;
                      const linkPath = module.link_path || (module.path_kind?.startsWith("lien") ? module.path : "");
                      const displaySourcePath = compactWorkspacePath(sourcePath, overview?.workspace);
                      const displayLinkPath = compactWorkspacePath(linkPath, overview?.workspace);
                      const samePaths = Boolean(linkPath && sourcePath && linkPath === sourcePath);
                      const origin = normalizedModuleOrigin(module.origin, sourcePath);
                      return (
                        <div
                          key={module.name}
                          className={cn(
                            "grid min-w-0 cursor-pointer gap-3 border-t p-3 transition-colors first:border-t-0 hover:bg-hover xl:items-center",
                            moduleTableGridColumns,
                            selectedModules.has(module.name) && "bg-selected",
                          )}
                          onClick={(event) => toggleModuleFromRow(event, module.name)}
                        >
                          <label className="flex min-w-0 cursor-pointer items-start gap-3 rounded-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                            <Checkbox
                              className="mt-1"
                              aria-label={`Sélectionner ${module.name}`}
                              checked={selectedModules.has(module.name)}
                              onCheckedChange={(checked) => toggleModuleSelection(module.name, checked === true)}
                            />
                            <span className="min-w-0">
                              <div className="break-words font-medium">{module.name}</div>
                              <div className="mt-0.5 break-words text-xs text-muted-foreground">
                                {module.title || module.name}
                              </div>
                            </span>
                          </label>
                          <div className="flex min-w-0 items-center justify-between gap-3 xl:block">
                            <span className="text-xs font-medium text-muted-foreground xl:hidden">État</span>
                            <ModuleStateBadge state={module.state} />
                          </div>
                          <div className="flex min-w-0 items-start justify-between gap-3 text-sm xl:block">
                            <span className="text-xs font-medium text-muted-foreground xl:hidden">Version</span>
                            <span className="min-w-0 break-words">
                              {module.installed_version || module.version || "-"}
                            </span>
                          </div>
                          <div className="flex min-w-0 items-center justify-between gap-3 xl:block">
                            <span className="text-xs font-medium text-muted-foreground xl:hidden">Origine</span>
                            <Badge className="shrink-0" variant="outline">
                              {moduleOriginLabel(origin)}
                            </Badge>
                          </div>
                          {showModuleLocations && (
                            <div className="min-w-0">
                              <div className="mb-1 text-xs font-medium text-muted-foreground xl:hidden">
                                Emplacements
                              </div>
                              <div className="space-y-1">
                                {module.path_kind && (
                                  <Badge
                                    className="w-fit max-w-full truncate"
                                    variant="outline"
                                    title={module.path_kind}
                                  >
                                    {module.path_kind}
                                  </Badge>
                                )}
                                <div className="min-w-0 text-xs">
                                  <span className="font-medium text-teal-700 dark:text-teal-300">Source</span>
                                  <div
                                    className="truncate font-mono text-teal-800 dark:text-teal-200"
                                    title={sourcePath}
                                  >
                                    {displaySourcePath || "-"}
                                  </div>
                                </div>
                                {displayLinkPath && !samePaths && (
                                  <div className="min-w-0 text-xs">
                                    <span className="font-medium text-blue-700 dark:text-blue-300">Lien Odoo</span>
                                    <div
                                      className="truncate font-mono text-blue-800 dark:text-blue-200"
                                      title={linkPath}
                                    >
                                      {displayLinkPath}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_40px] gap-2">
                            {module.state === "installed" ? (
                              <Button
                                className="w-full"
                                size="sm"
                                variant="accent"
                                disabled={!canUseDb}
                                onClick={() =>
                                  createJob("update_module", {
                                    project: selectedProject?.name,
                                    db: selectedDb,
                                    modules: module.name,
                                  })
                                }
                              >
                                <RefreshCcw className="h-4 w-4" />
                                Mettre à jour
                              </Button>
                            ) : (
                              <Button
                                className="w-full"
                                size="sm"
                                variant="success"
                                disabled={!canUseDb}
                                onClick={() =>
                                  createJob("install_module", {
                                    project: selectedProject?.name,
                                    db: selectedDb,
                                    modules: module.name,
                                  })
                                }
                              >
                                <PlusCircle className="h-4 w-4" />
                                Installer
                              </Button>
                            )}
                            <DropdownMenu.Root modal={false}>
                              <DropdownMenu.Trigger>
                                <Button
                                  size="icon"
                                  variant="outline"
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
                                    disabled={!canUseDb}
                                    onSelect={() => requestTranslationReset([module.name])}
                                  >
                                    <Languages className="h-4 w-4" />
                                    Réinitialiser les traductions
                                  </DropdownMenu.Item>
                                )}
                                {module.state === "installed" && (
                                  <DropdownMenu.Item
                                    color="red"
                                    disabled={!canUseDb}
                                    onSelect={() => requestUninstall([module.name])}
                                  >
                                    <PackageX className="h-4 w-4" />
                                    Désinstaller de la base
                                  </DropdownMenu.Item>
                                )}
                                {module.removal_mode !== "link_only" && (
                                  <DropdownMenu.Item
                                    color="red"
                                    disabled={!module.removable}
                                    onSelect={() => requestDeleteCode([module.name])}
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
                    })
                  : moduleEmptyState}
              </div>
              {modulePaginationBlock}
            </div>
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}
