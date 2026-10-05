"use client";

import type { Dispatch, SetStateAction } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import {
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
  Upload,
  UserCheck,
} from "lucide-react";
import { statusVariant } from "@/lib/format";
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

type DatabasesTabProps = {
  chooseDatabase: (db: string, projectName?: string | undefined) => void;
  dependencyReport: DependencyReport | null;
  executeDatabaseAction: (action: DatabaseMenuAction) => void;
  extendDatabaseRetention: (project: string, db: string) => void;
  loading: boolean;
  odooDatabases: string[];
  openingPostgresql: boolean;
  openUrl: (url?: string) => Promise<void>;
  postgresDetailsOpen: boolean;
  selectedDb: string;
  selectedProject: Project | undefined;
  selectedProjectReady: boolean;
  setCreateDbOpen: Dispatch<SetStateAction<boolean>>;
  setDependenciesOpen: Dispatch<SetStateAction<boolean>>;
  setPendingDatabaseAction: Dispatch<SetStateAction<PendingDatabaseAction | null>>;
  setPostgresDetailsOpen: Dispatch<SetStateAction<boolean>>;
  setRestoreDbOpen: Dispatch<SetStateAction<boolean>>;
};

export function DatabasesTab({
  chooseDatabase,
  dependencyReport,
  executeDatabaseAction,
  extendDatabaseRetention,
  loading,
  odooDatabases,
  openingPostgresql,
  openUrl,
  postgresDetailsOpen,
  selectedDb,
  selectedProject,
  selectedProjectReady,
  setCreateDbOpen,
  setDependenciesOpen,
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
      {dependencyNotice && <div className="mb-5">{dependencyNotice}</div>}
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
            {odooDatabases.map((db) => {
              const expiresAt = selectedProject?.database_retention?.[db]?.expires_at ?? null;
              const deletion = expiresAt === null ? null : deletionLabel(expiresAt);
              return (
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
                    {deletion && expiresAt !== null && (
                      <Badge
                        variant={DELETION_BADGE_VARIANTS[deletion.tone]}
                        className="mt-2 gap-1"
                        title={`Suppression automatique le ${deletionMoment(expiresAt)}. Pour la garder plus longtemps : menu « ⋯ », Garder 30 jours de plus.`}
                      >
                        <Timer className="h-3.5 w-3.5 shrink-0" />
                        {deletion.text}
                      </Badge>
                    )}
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
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "test_user")}>
                        <UserCheck className="h-4 w-4" />
                        Utilisateur de recette
                      </DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "fix_expiration")}>
                        <CalendarClock className="h-4 w-4" />
                        Corriger une base expirée
                      </DropdownMenu.Item>
                      {deletion && selectedProject && (
                        <DropdownMenu.Item onSelect={() => extendDatabaseRetention(selectedProject.name, db)}>
                          <CalendarPlus className="h-4 w-4" />
                          Garder 30 jours de plus
                        </DropdownMenu.Item>
                      )}
                      <DropdownMenu.Separator />
                      <DropdownMenu.Label>Outils</DropdownMenu.Label>
                      <DropdownMenu.Item onSelect={() => runDatabaseAction(db, "dependencies")}>
                        <PackageX className="h-4 w-4" />
                        Modules manquants
                      </DropdownMenu.Item>
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
                La console psql s’ouvre depuis le menu « ⋯ » d’une base, dans le terminal du système.
              </p>
            </div>
          )}
        </RefinedPanel>
      </div>
    </TabsContent>
  );
}
