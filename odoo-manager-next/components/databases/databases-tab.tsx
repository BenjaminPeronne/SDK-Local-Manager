"use client";

import type { Dispatch, SetStateAction } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import {
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
  Languages,
  Loader2,
  MoreHorizontal,
  Paintbrush,
  PlusCircle,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
} from "lucide-react";
import { statusVariant } from "@/lib/format";
import type { DatabaseMenuAction, PendingDatabaseAction, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, InteractiveCard } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import {
  REFINED_FOCUS_RING,
  REFINED_IDENTIFIER,
  REFINED_ROW_TITLE,
  RefinedPanel,
  RefinedSectionHeader,
} from "@/components/common/refined-layout";
import { FirstDatabaseCallout } from "@/components/databases/first-database-callout";

type DatabasesTabProps = {
  canUseDb: boolean;
  chooseDatabase: (db: string, projectName?: string | undefined) => void;
  executeDatabaseAction: (action: DatabaseMenuAction) => void;
  loading: boolean;
  odooDatabases: string[];
  openAllTranslationsReset: () => Promise<void>;
  openingPostgresql: boolean;
  openPostgresqlConsole: () => Promise<void>;
  openUrl: (url?: string) => Promise<void>;
  postgresDetailsOpen: boolean;
  refinedInterface: boolean;
  regenerateOdooAssets: () => Promise<void>;
  selectedDb: string;
  selectedProject: Project | undefined;
  selectedProjectReady: boolean;
  setAdminPasswordOpen: Dispatch<SetStateAction<boolean>>;
  setCreateDbOpen: Dispatch<SetStateAction<boolean>>;
  setDropDbOpen: Dispatch<SetStateAction<boolean>>;
  setDuplicateDbOpen: Dispatch<SetStateAction<boolean>>;
  setNeutralizeDbOpen: Dispatch<SetStateAction<boolean>>;
  setPendingDatabaseAction: Dispatch<SetStateAction<PendingDatabaseAction | null>>;
  setPostgresDetailsOpen: Dispatch<SetStateAction<boolean>>;
  setRestoreDbOpen: Dispatch<SetStateAction<boolean>>;
};

export function DatabasesTab({
  canUseDb,
  chooseDatabase,
  executeDatabaseAction,
  loading,
  odooDatabases,
  openAllTranslationsReset,
  openingPostgresql,
  openPostgresqlConsole,
  openUrl,
  postgresDetailsOpen,
  refinedInterface,
  regenerateOdooAssets,
  selectedDb,
  selectedProject,
  selectedProjectReady,
  setAdminPasswordOpen,
  setCreateDbOpen,
  setDropDbOpen,
  setDuplicateDbOpen,
  setNeutralizeDbOpen,
  setPendingDatabaseAction,
  setPostgresDetailsOpen,
  setRestoreDbOpen,
}: DatabasesTabProps) {
  function runDatabaseAction(db: string, action: DatabaseMenuAction) {
    if (db !== selectedDb) {
      // Les actions lisent la base sélectionnée : on attend que la sélection soit appliquée.
      chooseDatabase(db);
      setPendingDatabaseAction({ db, action });
      return;
    }
    executeDatabaseAction(action);
  }

  return (
    <TabsContent value="bases">
      {refinedInterface ? (
        <div className="space-y-5">
          <RefinedSectionHeader
            title="Bases de données"
            count={odooDatabases.length}
            description="Sélectionne la base sur laquelle travailler."
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

          {odooDatabases.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {odooDatabases.map((db) => (
                <div key={db} className="group relative min-w-0">
                  <InteractiveCard
                    aria-pressed={selectedDb === db}
                    className={cn(
                      "w-full min-w-0 p-4 pr-14",
                      selectedDb === db
                        ? "border-primary bg-selected ring-2 ring-primary/35"
                        : "hover:border-primary/35 hover:bg-hover",
                    )}
                    onClick={() => chooseDatabase(db)}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <span className={cn("min-w-0 break-all", REFINED_IDENTIFIER)}>{db}</span>
                      {db === selectedDb && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                    </div>
                    <div
                      className={cn(
                        "mt-2 text-xs",
                        db === selectedDb ? "font-medium text-primary" : "text-muted-foreground",
                      )}
                    >
                      {db === selectedDb ? "Base de travail" : selectedProject?.database_versions?.[db] || "Base Odoo"}
                    </div>
                  </InteractiveCard>
                  <DropdownMenu.Root modal={false}>
                    <DropdownMenu.Trigger>
                      <Button
                        size="icon"
                        variant="ghost"
                        className={cn(
                          "absolute right-2 top-2 h-9 w-9 transition-opacity focus-visible:opacity-100 data-[state=open]:opacity-100",
                          db !== selectedDb && "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
                        )}
                        disabled={loading}
                        title={`Actions sur ${db}`}
                        aria-label={`Actions sur ${db}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" className="min-w-60">
                      <DropdownMenu.Label>Maintenance</DropdownMenu.Label>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "regenerate_assets")}>
                        <Paintbrush className="h-4 w-4" />
                        Régénérer les assets
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "reset_translations")}>
                        <Languages className="h-4 w-4" />
                        Réinitialiser les traductions
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "neutralize")}>
                        <ShieldCheck className="h-4 w-4" />
                        Neutraliser et contrôler
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "admin_password")}>
                        <KeyRound className="h-4 w-4" />
                        Mot de passe admin
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Label>Outils</DropdownMenu.Label>
                      <DropdownMenu.Item
                        disabled={!selectedProjectReady}
                        onSelect={() => runDatabaseAction(db, "duplicate")}
                      >
                        <Copy className="h-4 w-4" />
                        Dupliquer la base
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={selectedProject?.postgres_status !== "running" || openingPostgresql}
                        onSelect={() => runDatabaseAction(db, "psql")}
                      >
                        <Terminal className="h-4 w-4" />
                        Ouvrir psql
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Label>Zone dangereuse</DropdownMenu.Label>
                      <DropdownMenu.Item color="red" onSelect={() => runDatabaseAction(db, "drop")}>
                        <Trash2 className="h-4 w-4" />
                        Supprimer la base
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
              ))}
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
                  La console psql s’ouvre depuis le menu « ⋯ » d’une base, dans le terminal du système.
                </p>
              </div>
            )}
          </RefinedPanel>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
          <Card>
            <CardHeader>
              <CardTitle>Bases Odoo</CardTitle>
              <CardDescription>
                Sélectionne l’environnement Odoo utilisé pour les modules et les actions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {odooDatabases.length ? (
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {odooDatabases.map((db) => (
                    <InteractiveCard
                      key={db}
                      className={cn(
                        "min-w-0 p-4",
                        selectedDb === db && "border-primary bg-selected ring-1 ring-primary/25",
                      )}
                      onClick={() => chooseDatabase(db)}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0 break-words font-medium">{db}</span>
                        {db === selectedDb && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {selectedProject?.database_versions?.[db] || "Base Odoo"}
                      </div>
                    </InteractiveCard>
                  ))}
                </div>
              ) : (
                <FirstDatabaseCallout
                  disabled={!selectedProjectReady}
                  onCreate={() => setCreateDbOpen(true)}
                  onRestore={() => setRestoreDbOpen(true)}
                />
              )}
            </CardContent>
          </Card>
          <div className="grid min-w-0 content-start gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Créer une base Odoo</CardTitle>
                <CardDescription>Ajoute une nouvelle base métier au projet sélectionné.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" disabled={!selectedProjectReady} onClick={() => setCreateDbOpen(true)}>
                  <PlusCircle className="h-4 w-4" />
                  Créer une base Odoo
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!selectedProjectReady}
                  onClick={() => setRestoreDbOpen(true)}
                >
                  <Upload className="h-4 w-4" />
                  Restaurer une sauvegarde ZIP
                </Button>
                {selectedProject && (
                  <Button
                    className="w-full"
                    variant="ghost"
                    onClick={() => openUrl(selectedProject.database_manager_url)}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Gestionnaire de bases Odoo
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Neutraliser la base</CardTitle>
                <CardDescription>
                  Coupe les crons métier et les serveurs de messagerie, puis vérifie le résultat.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="min-w-0 rounded-md bg-muted/55 p-3 text-sm">
                  <div className="text-muted-foreground">Base ciblée</div>
                  <div className="mt-1 break-words font-medium">{selectedDb || "Aucune base sélectionnée"}</div>
                </div>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!canUseDb || loading}
                  onClick={() => setNeutralizeDbOpen(true)}
                >
                  <ShieldCheck className="h-4 w-4" />
                  Neutraliser et contrôler
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!canUseDb || loading}
                  onClick={regenerateOdooAssets}
                  title="Supprime les bundles CSS/JS compilés ; Odoo redémarre et les reconstruit au prochain chargement."
                >
                  <Paintbrush className="h-4 w-4" />
                  Régénérer les assets
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!canUseDb || loading}
                  onClick={openAllTranslationsReset}
                >
                  <Languages className="h-4 w-4" />
                  Réinitialiser les traductions
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!canUseDb || loading}
                  onClick={() => setAdminPasswordOpen(true)}
                >
                  <KeyRound className="h-4 w-4" />
                  Réinitialiser le mot de passe admin
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!canUseDb || !selectedProjectReady || loading}
                  onClick={() => setDuplicateDbOpen(true)}
                >
                  <Copy className="h-4 w-4" />
                  Dupliquer la base
                </Button>
                <Button
                  className="w-full text-destructive hover:text-destructive"
                  variant="outline"
                  disabled={!canUseDb || loading}
                  onClick={() => setDropDbOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Supprimer la base
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle>Serveur PostgreSQL</CardTitle>
                    <CardDescription className="mt-1">
                      Service technique qui stocke les bases Odoo. Il ne se sélectionne pas comme une base métier.
                    </CardDescription>
                  </div>
                  <Badge variant={statusVariant(selectedProject?.postgres_status || "absent")} className="shrink-0">
                    {selectedProject?.postgres_status || "absent"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="min-w-0 rounded-md bg-muted/55 p-3 text-sm">
                  <div className="text-muted-foreground">Conteneur</div>
                  <div className="mt-1 break-all font-medium">
                    {selectedProject ? `postgresql-${selectedProject.name}` : "-"}
                  </div>
                  <div className="mt-3 text-muted-foreground">Base Odoo ciblée</div>
                  <div className="mt-1 break-words font-medium">{selectedDb || "Aucune base sélectionnée"}</div>
                </div>
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!canUseDb || selectedProject?.postgres_status !== "running" || openingPostgresql}
                  onClick={openPostgresqlConsole}
                >
                  {openingPostgresql ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
                  Ouvrir psql
                </Button>
                <p className="text-xs text-muted-foreground">
                  La console s’ouvre dans le terminal du système avec la base Odoo sélectionnée.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </TabsContent>
  );
}
