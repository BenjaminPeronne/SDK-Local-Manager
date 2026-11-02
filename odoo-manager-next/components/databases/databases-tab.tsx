"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import {
  LayoutGrid,
  List,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
  Languages,
  MoreHorizontal,
  PackageX,
  Paintbrush,
  PlusCircle,
  ShieldCheck,
  Terminal,
  Timer,
  Trash2,
  TriangleAlert,
  Upload,
  UserCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatNameList, statusVariant } from "@/lib/format";
import { deletionLabel, deletionMoment, type RetentionTone } from "@/lib/retention";
import type { DatabaseMenuAction, DependencyReport, PendingDatabaseAction, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InteractiveCard } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import {
  REFINED_FOCUS_RING,
  REFINED_IDENTIFIER,
  REFINED_ROW_TITLE,
  RefinedPanel,
  RefinedSectionHeader,
} from "@/components/common/refined-layout";
import { Notice } from "@/components/common/notice";
import { dependencySummary } from "@/components/databases/dependencies-dialog";
import { FirstDatabaseCallout } from "@/components/databases/first-database-callout";

// Couleur de l'échéance : grise au loin, orange dans les deux semaines, rouge dans les trois jours.
const DELETION_BADGE_VARIANTS: Record<RetentionTone, "secondary" | "warning" | "danger"> = {
  muted: "secondary",
  warning: "warning",
  danger: "danger",
};

type DatabaseView = "cards" | "list";
const DATABASE_VIEWS_KEY = "sdk-local-manager.database-views";
function storedDatabaseViews(): Record<string, DatabaseView> {
  try {
    const value = JSON.parse(window.localStorage.getItem(DATABASE_VIEWS_KEY) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, DatabaseView] => entry[1] === "cards" || entry[1] === "list",
      ),
    );
  } catch {
    return {};
  }
}

type DatabasesTabProps = {
  workspace: string;
  chooseDatabase: (db: string, projectName?: string | undefined) => void;
  dependencyReport: DependencyReport | null;
  executeDatabaseAction: (action: DatabaseMenuAction) => void;
  extendDatabaseRetention: (project: string, db: string) => void;
  loading: boolean;
  odooDatabases: string[];
  openingPostgresql: boolean;
  openUrl: (url?: string) => Promise<void>;
  selectedDb: string;
  selectedProject: Project | undefined;
  selectedProjectReady: boolean;
  setCreateDbOpen: Dispatch<SetStateAction<boolean>>;
  setDependenciesOpen: Dispatch<SetStateAction<boolean>>;
  setPendingDatabaseAction: Dispatch<SetStateAction<PendingDatabaseAction | null>>;
  setRestoreDbOpen: Dispatch<SetStateAction<boolean>>;
};

export function DatabasesTab({
  workspace,
  chooseDatabase,
  dependencyReport,
  executeDatabaseAction,
  extendDatabaseRetention,
  loading,
  odooDatabases,
  openingPostgresql,
  openUrl,
  selectedDb,
  selectedProject,
  selectedProjectReady,
  setCreateDbOpen,
  setDependenciesOpen,
  setPendingDatabaseAction,
  setRestoreDbOpen,
}: DatabasesTabProps) {
  const [postgresDetailsOpen, setPostgresDetailsOpen] = useState(false);
  // Bases dont la restauration s'est arrêtée avant la fin : relu à l'ouverture du projet et quand
  // la liste des bases change (suppression, nouvelle restauration).
  const [databaseVersions, setDatabaseVersions] = useState<{
    project: string;
    versions: Record<string, string>;
    incomplete: string[];
  } | null>(null);
  const [viewPreferences, setViewPreferences] = useState(storedDatabaseViews);
  const preferenceKey = JSON.stringify([workspace, selectedProject?.name || ""]);
  const listView = (viewPreferences[preferenceKey] || (odooDatabases.length > 4 ? "list" : "cards")) === "list";
  function chooseView(view: DatabaseView) {
    const next = { ...viewPreferences, [preferenceKey]: view };
    setViewPreferences(next);
    try {
      window.localStorage.setItem(DATABASE_VIEWS_KEY, JSON.stringify(next));
    } catch {
      /* Vue conservée pour cette session. */
    }
  }
  const DatabaseItem = listView ? "button" : InteractiveCard;
  const projectName = selectedProject?.name;
  const postgresRunning = selectedProject?.postgres_status === "running";
  const databasesKey = odooDatabases.join(",");
  useEffect(() => {
    if (!projectName || !postgresRunning || !databasesKey) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const payload = await api<{ versions?: Record<string, string>; incomplete?: string[] }>(
          `/api/projects/${encodeURIComponent(projectName)}/database-versions`,
        );
        if (!cancelled)
          setDatabaseVersions({
            project: projectName,
            versions: payload.versions ?? {},
            incomplete: payload.incomplete ?? [],
          });
      } catch {
        if (!cancelled) setDatabaseVersions(null);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectName, postgresRunning, databasesKey]);
  const versions = databaseVersions && databaseVersions.project === projectName ? databaseVersions.versions : {};
  const incomplete = (
    databaseVersions && databaseVersions.project === projectName ? databaseVersions.incomplete : []
  ).filter((db) => odooDatabases.includes(db));

  function runDatabaseAction(db: string, action: DatabaseMenuAction) {
    if (db !== selectedDb) {
      // Les actions lisent la base sélectionnée : on attend que la sélection soit appliquée.
      chooseDatabase(db);
      setPendingDatabaseAction({ db, action });
      return;
    }
    executeDatabaseAction(action);
  }

  const dependencyProblem = dependencyReport && !dependencyReport.ok ? dependencyReport : null;
  const dependencyNotice = dependencyProblem && (
    <Notice
      tone={dependencyProblem.not_loaded.length ? "danger" : "warning"}
      icon={PackageX}
      title={`${dependencyProblem.db} : ${dependencySummary(dependencyProblem)}`}
      actions={
        <Button className="w-full sm:w-auto" size="sm" variant="outline" onClick={() => setDependenciesOpen(true)}>
          Voir le détail
        </Button>
      }
    >
      {dependencyProblem.not_loaded.length
        ? "Certains écrans d’Odoo peuvent afficher des erreurs. Ajoute les modules manquants au projet."
        : "Des modules utilisés par cette base ne sont pas dans le projet."}
    </Notice>
  );

  return (
    <TabsContent value="bases">
      {incomplete.length > 0 && (
        <div className="mb-5">
          <Notice
            tone="danger"
            icon={TriangleAlert}
            title={
              incomplete.length > 1
                ? `Bases incomplètes : ${formatNameList(incomplete)}`
                : `Base incomplète : ${incomplete[0]}`
            }
          >
            Sa restauration s’est arrêtée avant la fin : il lui manque une partie de sa structure, elle n’est pas fiable
            même si Odoo l’ouvre. Supprime-la depuis « Actions » sur la base, puis restaure de nouveau la sauvegarde.
          </Notice>
        </div>
      )}
      {dependencyNotice && <div className="mb-5">{dependencyNotice}</div>}
      <div className="space-y-5">
        <RefinedSectionHeader
          title="Bases de données"
          count={odooDatabases.length}
          description="Sélectionne une base pour travailler dessus. Le bouton Actions permet de la gérer."
          actions={
            <>
              {selectedProject && (
                <Button
                  variant="ghost"
                  onClick={() => openUrl(selectedProject.database_manager_url)}
                  title="Ouvrir le gestionnaire de bases d’Odoo"
                >
                  <ExternalLink className="h-4 w-4" />
                  Gestionnaire Odoo
                </Button>
              )}
              <Button variant="outline" disabled={!selectedProjectReady} onClick={() => setRestoreDbOpen(true)}>
                <Upload className="h-4 w-4" />
                Restaurer
              </Button>
              <Button disabled={!selectedProjectReady} onClick={() => setCreateDbOpen(true)}>
                <PlusCircle className="h-4 w-4" />
                Créer une base
              </Button>
            </>
          }
        />

        {odooDatabases.length > 0 && (
          <div className="flex justify-end gap-1" role="group" aria-label="Affichage des bases">
            <Button
              size="sm"
              variant={!listView ? "secondary" : "ghost"}
              aria-pressed={!listView}
              onClick={() => chooseView("cards")}
            >
              <LayoutGrid className="h-4 w-4" />
              Cartes
            </Button>
            <Button
              size="sm"
              variant={listView ? "secondary" : "ghost"}
              aria-pressed={listView}
              onClick={() => chooseView("list")}
            >
              <List className="h-4 w-4" />
              Liste
            </Button>
          </div>
        )}
        {odooDatabases.length ? (
          <div
            role="group"
            aria-label={`Bases du projet ${selectedProject?.name || ""}`}
            className={cn(listView ? "overflow-hidden rounded-lg border bg-card" : "grid gap-3 sm:grid-cols-2")}
          >
            {listView && (
              <div
                className="sdk-database-list-heading hidden border-b bg-muted/60 text-xs font-semibold text-muted-foreground md:grid"
                aria-hidden="true"
              >
                <span>Base de données</span>
                <span>Version</span>
                <span>Conservation et état</span>
                <span className="text-right">Actions</span>
              </div>
            )}
            {odooDatabases.map((db) => {
              const expiresAt = selectedProject?.database_retention?.[db]?.expires_at ?? null;
              const deletion = expiresAt === null ? null : deletionLabel(expiresAt);
              return (
                <div key={db} className={cn("relative min-w-0", listView && "border-b last:border-b-0")}>
                  <DatabaseItem
                    type="button"
                    aria-label={`Sélectionner la base ${db}`}
                    aria-pressed={selectedDb === db}
                    className={cn(
                      "w-full min-w-0 p-4 text-left",
                      listView && cn("sdk-database-list-row transition-colors hover:bg-hover", REFINED_FOCUS_RING),
                      selectedDb === db
                        ? listView
                          ? "bg-selected"
                          : "border-primary bg-selected ring-2 ring-primary/35"
                        : !listView && "hover:border-primary/35 hover:bg-hover",
                    )}
                    onClick={() => chooseDatabase(db)}
                  >
                    <div className="flex min-w-0 items-start gap-2 pr-24">
                      <span className={cn("min-w-0 break-all", REFINED_IDENTIFIER)}>{db}</span>
                      {db === selectedDb && (
                        <CheckCircle2 aria-label="Base de travail" className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </div>
                    {listView && (
                      <div className="text-xs text-muted-foreground">
                        <span className="md:hidden">Version : </span>
                        {versions[db] || "—"}
                      </div>
                    )}
                    <div className={cn(listView && "sdk-database-list-meta")}>
                      {!listView && (
                        <div
                          className={cn(
                            "mt-2 text-xs",
                            db === selectedDb ? "font-medium text-primary" : "text-muted-foreground",
                          )}
                        >
                          {db === selectedDb ? "Base de travail" : versions[db] || "Base Odoo"}
                        </div>
                      )}
                      {listView && !deletion && <span className="text-xs text-muted-foreground">Sans échéance</span>}
                      {incomplete.includes(db) && (
                        <Badge variant="danger" className="mt-2 mr-2 gap-1">
                          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                          Incomplète
                        </Badge>
                      )}
                      {deletion && expiresAt !== null && (
                        <Badge
                          variant={DELETION_BADGE_VARIANTS[deletion.tone]}
                          className="mt-2 gap-1"
                          title={`Suppression automatique le ${deletionMoment(expiresAt)}. Pour la garder plus longtemps : Actions, puis Prolonger la conservation de 30 jours.`}
                        >
                          <Timer className="h-3.5 w-3.5 shrink-0" />
                          {deletion.text}
                        </Badge>
                      )}
                    </div>
                  </DatabaseItem>
                  <DropdownMenu.Root modal={false}>
                    <DropdownMenu.Trigger>
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn("absolute right-2", listView ? "top-1/2 -translate-y-1/2" : "top-2")}
                        disabled={loading}
                        title={`Actions sur ${db}`}
                        aria-label={`Actions sur ${db}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        Actions
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" className="w-[min(22rem,calc(100vw-2rem))]">
                      <DropdownMenu.Label className="truncate" title={db}>
                        Actions sur {db}
                      </DropdownMenu.Label>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Label>Entretenir la base</DropdownMenu.Label>
                      <DropdownMenu.Item
                        className="h-auto items-start py-2"
                        onSelect={() => runDatabaseAction(db, "regenerate_assets")}
                      >
                        <Paintbrush className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <span className="block">Régénérer les ressources d’affichage</span>
                          <span className="block text-xs text-muted-foreground">Reconstruit les assets de la base</span>
                        </span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "reset_translations")}>
                        <Languages className="h-4 w-4" />
                        Réinitialiser les traductions
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "fix_expiration")}>
                        <CalendarClock className="h-4 w-4" />
                        Corriger une base expirée
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Label>Sécuriser et préparer</DropdownMenu.Label>
                      <DropdownMenu.Item
                        className="h-auto items-start py-2"
                        onSelect={() => runDatabaseAction(db, "neutralize")}
                      >
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <span className="block">Neutraliser et contrôler</span>
                          <span className="block text-xs text-muted-foreground">
                            Réduit les risques d’envois et d’automatisations
                          </span>
                        </span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "admin_password")}>
                        <KeyRound className="h-4 w-4" />
                        Modifier le mot de passe administrateur
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "test_user")}>
                        <UserCheck className="h-4 w-4" />
                        Configurer un utilisateur de recette
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Label>Gérer la base</DropdownMenu.Label>
                      {deletion && selectedProject && (
                        <DropdownMenu.Item onSelect={() => extendDatabaseRetention(selectedProject.name, db)}>
                          <CalendarPlus className="h-4 w-4" />
                          Prolonger la conservation de 30 jours
                        </DropdownMenu.Item>
                      )}
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "dependencies")}>
                        <PackageX className="h-4 w-4" />
                        Vérifier les modules manquants
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={!selectedProjectReady}
                        onSelect={() => runDatabaseAction(db, "duplicate")}
                      >
                        <Copy className="h-4 w-4" />
                        Dupliquer la base
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger>Actions avancées</DropdownMenu.SubTrigger>
                        <DropdownMenu.SubContent>
                          <DropdownMenu.Item
                            disabled={selectedProject?.postgres_status !== "running" || openingPostgresql}
                            onSelect={() => runDatabaseAction(db, "psql")}
                          >
                            <Terminal className="h-4 w-4" />
                            Ouvrir PostgreSQL (psql)
                          </DropdownMenu.Item>
                        </DropdownMenu.SubContent>
                      </DropdownMenu.Sub>
                      <DropdownMenu.Item color="red" onSelect={() => runDatabaseAction(db, "drop")}>
                        <Trash2 className="h-4 w-4" />
                        Supprimer la base
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
              );
            })}
          </div>
        ) : (
          <FirstDatabaseCallout
            disabled={!selectedProjectReady}
            onCreate={() => setCreateDbOpen(true)}
            onRestore={() => setRestoreDbOpen(true)}
          />
        )}

        <RefinedPanel>
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-md p-4 text-left transition-colors hover:bg-hover",
              REFINED_FOCUS_RING,
            )}
            aria-expanded={postgresDetailsOpen}
            aria-controls="refined-postgres-details"
            onClick={() => setPostgresDetailsOpen((open) => !open)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <ChevronRight
                className={cn("h-4 w-4 shrink-0 transition-transform", postgresDetailsOpen && "rotate-90")}
              />
              <span className={cn("min-w-0", REFINED_ROW_TITLE)}>Infrastructure · PostgreSQL</span>
            </span>
            <Badge variant={statusVariant(selectedProject?.postgres_status || "absent")} className="shrink-0">
              {selectedProject?.postgres_status || "absent"}
            </Badge>
          </button>
          {postgresDetailsOpen && (
            <div id="refined-postgres-details" className="grid gap-3 border-t p-4 sm:grid-cols-2">
              <div className="min-w-0 rounded-md bg-muted/55 p-3">
                <div className="text-xs text-muted-foreground">Conteneur</div>
                <div className={cn("mt-1 break-all", REFINED_IDENTIFIER)}>
                  {selectedProject ? `postgresql-${selectedProject.name}` : "-"}
                </div>
              </div>
              <div className="min-w-0 rounded-md bg-muted/55 p-3">
                <div className="text-xs text-muted-foreground">Base Odoo ciblée</div>
                <div
                  className={cn("mt-1 break-all", selectedDb ? REFINED_IDENTIFIER : "text-sm text-muted-foreground")}
                >
                  {selectedDb || "Aucune base sélectionnée"}
                </div>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                La console psql s’ouvre depuis le bouton « Actions » d’une base, dans le terminal du système.
              </p>
            </div>
          )}
        </RefinedPanel>
      </div>
    </TabsContent>
  );
}
