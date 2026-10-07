"use client";

import {
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";
import { DropdownMenu, SegmentedControl } from "@radix-ui/themes";
import {
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CloudDownload,
  FileArchive,
  FolderGit2,
  List,
  Loader2,
  PlusCircle,
  RefreshCcw,
  Search,
} from "lucide-react";
import { type ModuleFilters, type ModuleView, MODULES_PER_PAGE } from "@/hooks/use-module-filters";
import { groupModulesByRepository } from "@/lib/module-repositories";
import type { Job, ManagerSettings, ModuleInfo, ModuleRepository, Overview, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import {
  REFINED_LABEL,
  REFINED_MODULE_COLUMNS,
  RefinedPanel,
  RefinedSectionHeader,
} from "@/components/common/refined-layout";
import {
  groupExpanded,
  ModuleRepositoryGroups,
  type RepositoryFolding,
} from "@/components/modules/module-repository-groups";
import { ModuleRow, type ModuleRowActions } from "@/components/modules/module-row";

type ModulesTabProps = {
  canUseDb: boolean;
  checkingUpdatePrerequisites: boolean;
  chooseDatabase: (db: string, projectName?: string | undefined) => void;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  loadingModules: boolean;
  moduleFilters: ModuleFilters;
  modules: ModuleInfo[];
  moduleRepositories: ModuleRepository[];
  moduleSelectionBlock: ReactNode;
  odooDatabases: string[];
  openRepositoryImport: () => void;
  openUrl: (url?: string) => Promise<void>;
  openSocleDialog: () => void;
  openZipImport: () => void;
  overview: Overview | null;
  projectHeaderHeight: number;
  projectTabsHeight: number;
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
  moduleRepositories,
  moduleSelectionBlock,
  odooDatabases,
  openRepositoryImport,
  openUrl,
  openSocleDialog,
  openZipImport,
  overview,
  projectHeaderHeight,
  projectTabsHeight,
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
  const projectName = selectedProject?.name;
  const rowActions = useMemo<ModuleRowActions>(
    () => ({
      canUseDb,
      installModule: (name) =>
        void createJob("install_module", { project: projectName, db: selectedDb, modules: name }),
      updateModule: (name) => void createJob("update_module", { project: projectName, db: selectedDb, modules: name }),
      requestDeleteCode,
      requestTranslationReset,
      requestUninstall,
      restoreRepositoryVersion: (name) =>
        void createJob("restore_module_source", { project: projectName, module: name }),
      toggleFromRow: toggleModuleFromRow,
      toggleSelection: toggleModuleSelection,
    }),
    [
      canUseDb,
      createJob,
      projectName,
      requestDeleteCode,
      requestTranslationReset,
      requestUninstall,
      selectedDb,
      toggleModuleFromRow,
      toggleModuleSelection,
    ],
  );
  const repositoryView = moduleFilters.view === "repository";
  const repositoryGroups = useMemo(
    () => (repositoryView ? groupModulesByRepository(moduleFilters.filtered, moduleRepositories) : []),
    [moduleFilters.filtered, moduleRepositories, repositoryView],
  );
  // Dépôts repliés ou dépliés à la main, valables pour la recherche en cours : une nouvelle
  // recherche rouvre les dépôts qui ont des résultats.
  const searchKey = moduleFilters.search.trim();
  const [repositoryFolding, setRepositoryFolding] = useState<{ search: string; folding: RepositoryFolding }>({
    search: "",
    folding: {},
  });
  const folding = repositoryFolding.search === searchKey ? repositoryFolding.folding : {};
  const expandedGroups = repositoryGroups.filter((group) => groupExpanded(group, folding, searchKey !== "")).length;
  function foldGroup(groupId: string, expanded: boolean) {
    setRepositoryFolding((current) => ({
      search: searchKey,
      folding: { ...(current.search === searchKey ? current.folding : {}), [groupId]: expanded },
    }));
  }
  function foldAllGroups(expanded: boolean) {
    setRepositoryFolding({
      search: searchKey,
      folding: Object.fromEntries(repositoryGroups.map((group) => [group.id, expanded])),
    });
  }
  // Filtres et sélection des modules : identiques en affichage classique et affiné.
  const moduleFiltersBlock = (
    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_210px_220px]">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Rechercher un module (nom ou titre)"
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
          <SelectItem value="odoo">Odoo Community</SelectItem>
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
  const moduleViewBlock = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <SegmentedControl.Root
        size="1"
        value={moduleFilters.view}
        onValueChange={(value) => moduleFilters.setView(value as ModuleView)}
        aria-label="Affichage des modules"
      >
        <SegmentedControl.Item value="list">
          <span className="flex items-center gap-1.5">
            <List className="h-3.5 w-3.5" aria-hidden="true" />
            Liste
          </span>
        </SegmentedControl.Item>
        <SegmentedControl.Item value="repository">
          <span className="flex items-center gap-1.5">
            <FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />
            Par dépôt
          </span>
        </SegmentedControl.Item>
      </SegmentedControl.Root>
      {repositoryView && repositoryGroups.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-muted-foreground">
            {repositoryGroups.filter((group) => group.repository).length} dépôt(s) · branche chargée affichée pour
            chacun
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={expandedGroups === repositoryGroups.length}
              onClick={() => foldAllGroups(true)}
            >
              <ChevronsUpDown className="h-4 w-4" />
              Tout déplier
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={expandedGroups === 0}
              onClick={() => foldAllGroups(false)}
            >
              <ChevronsDownUp className="h-4 w-4" />
              Tout replier
            </Button>
          </div>
        </div>
      )}
    </div>
  );
  const modulePaginationBlock = !repositoryView && moduleFilters.filtered.length > 0 && (
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
        {moduleViewBlock}
        {moduleSelectionBlock}
        {/* overflow-clip arrondit les coins sans créer de conteneur de défilement, contrairement à
              overflow-hidden qui empêcherait l'en-tête de rester collé. L'en-tête reste donc un bandeau droit :
              des coins arrondis collés en haut laisseraient voir les lignes qui défilent derrière. */}
        <RefinedPanel className="overflow-clip">
          <div
            className="z-10 hidden border-b bg-card xl:sticky xl:block"
            style={{ top: stickyHeader ? projectHeaderHeight + projectTabsHeight : 0 }}
          >
            <div className={cn("grid items-center gap-3 bg-muted/60 px-3 py-2", REFINED_LABEL, REFINED_MODULE_COLUMNS)}>
              <div>Module</div>
              <div>État</div>
              <div>Version</div>
              <div>Origine</div>
              <div className="text-right">Actions</div>
            </div>
          </div>
          {repositoryView ? (
            repositoryGroups.length ? (
              <ModuleRepositoryGroups
                folding={folding}
                groups={repositoryGroups}
                onFold={foldGroup}
                openUrl={openUrl}
                rowActions={rowActions}
                searchActive={searchKey !== ""}
                selectedModules={selectedModules}
                setSelectedModules={setSelectedModules}
                showLocations={showModuleLocations}
                workspace={overview?.workspace}
              />
            ) : (
              moduleEmptyState
            )
          ) : (
            <div className="min-w-0">
              {moduleFilters.visible.length
                ? moduleFilters.visible.map((module) => (
                    <ModuleRow
                      key={module.name}
                      actions={rowActions}
                      module={module}
                      selected={selectedModules.has(module.name)}
                      showLocations={showModuleLocations}
                      workspace={overview?.workspace}
                    />
                  ))
                : moduleEmptyState}
            </div>
          )}
          {modulePaginationBlock}
        </RefinedPanel>
      </div>
    </TabsContent>
  );
}
