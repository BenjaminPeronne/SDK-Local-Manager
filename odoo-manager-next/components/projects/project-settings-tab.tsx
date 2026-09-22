"use client";

import type { Dispatch, SetStateAction } from "react";
import { CloudDownload, ExternalLink, Trash2 } from "lucide-react";
import type { Job, ManagerSettings, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { RefinedPanel, RefinedRow, RefinedSectionHeader } from "@/components/common/refined-layout";

type ProjectSettingsTabProps = {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  openUrl: (url?: string) => Promise<void>;
  refinedInterface: boolean;
  selectedProject: Project | undefined;
  selectedProjectReady: boolean;
  setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>;
  settings: ManagerSettings | null;
};

export function ProjectSettingsTab({
  createJob,
  openUrl,
  refinedInterface,
  selectedProject,
  selectedProjectReady,
  setDeleteDialogOpen,
  settings,
}: ProjectSettingsTabProps) {
  return (
    <TabsContent value="actions">
      {refinedInterface ? (
        <div className="space-y-5">
          <RefinedSectionHeader
            title="Réglages du projet"
            description={selectedProject ? `Paramètres et actions de ${selectedProject.name}.` : undefined}
          />
          <RefinedPanel>
            <RefinedRow
              title="Environnement"
              description={selectedProject?.odoo_version ? `Odoo ${selectedProject.odoo_version} · Docker` : "Docker"}
            >
              {selectedProject && (
                <Button variant="outline" onClick={() => openUrl(selectedProject.url)}>
                  <ExternalLink className="h-4 w-4" />
                  Ouvrir Odoo
                </Button>
              )}
            </RefinedRow>
            {settings?.show_technical_details && (
              <RefinedRow
                className="border-t"
                title="Code et images"
                description="Met à jour les sources et images Docker."
              >
                <Button
                  variant="outline"
                  disabled={!selectedProjectReady}
                  onClick={() => createJob("update_project", { project: selectedProject?.name })}
                >
                  <CloudDownload className="h-4 w-4" />
                  MAJ projet
                </Button>
                <Button variant="outline" onClick={() => createJob("update_all")}>
                  <CloudDownload className="h-4 w-4" />
                  MAJ tous les projets
                </Button>
              </RefinedRow>
            )}
            <RefinedRow
              className="border-t"
              title="Suppression du projet"
              description={
                <>
                  Action définitive. Le projet est déplacé dans <code className="text-xs">.odoo_manager_deleted</code>{" "}
                  et le nom devra être saisi pour confirmer.
                </>
              }
            >
              <Button variant="destructive" disabled={!selectedProjectReady} onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="h-4 w-4" />
                Supprimer le projet…
              </Button>
            </RefinedRow>
          </RefinedPanel>
        </div>
      ) : (
        <div className={cn("grid gap-4", settings?.show_technical_details && "xl:grid-cols-2")}>
          {settings?.show_technical_details && (
            <Card>
              <CardHeader>
                <CardTitle>Code et images</CardTitle>
                <CardDescription>Met à jour les sources et images Docker.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!selectedProjectReady}
                  onClick={() => createJob("update_project", { project: selectedProject?.name })}
                >
                  <CloudDownload className="h-4 w-4" />
                  MAJ projet
                </Button>
                <Button className="w-full" onClick={() => createJob("update_all")}>
                  <CloudDownload className="h-4 w-4" />
                  MAJ tous les projets
                </Button>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Zone sensible</CardTitle>
              <CardDescription>Suppression du projet local sélectionné.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                className="w-full"
                variant="destructive"
                disabled={!selectedProjectReady}
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer projet
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </TabsContent>
  );
}
