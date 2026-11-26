"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { CloudDownload, ExternalLink, Trash2 } from "lucide-react";
import type { Job, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { RefinedPanel, RefinedRow, RefinedSectionHeader } from "@/components/common/refined-layout";

type ProjectSettingsTabProps = {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  openUrl: (url?: string) => Promise<void>;
  selectedProject: Project | undefined;
  selectedProjectReady: boolean;
  setDeleteDialogOpen: Dispatch<SetStateAction<boolean>>;
};

function SettingsGroup({ id, title, danger, children }: { id: string; title: string; danger?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h4 id={id} className={danger ? "text-sm font-semibold text-destructive" : "text-sm font-semibold text-muted-foreground"}>
        {title}
      </h4>
      {children}
    </section>
  );
}

export function ProjectSettingsTab({
  createJob,
  openUrl,
  selectedProject,
  selectedProjectReady,
  setDeleteDialogOpen,
}: ProjectSettingsTabProps) {
  return (
    <TabsContent value="actions">
      <div className="mx-auto max-w-4xl space-y-6">
        <RefinedSectionHeader
          title="Réglages du projet"
          description={selectedProject ? `Paramètres et actions de ${selectedProject.name}.` : undefined}
        />
        <SettingsGroup id="project-settings-general" title="Général">
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
          </RefinedPanel>
        </SettingsGroup>
        <SettingsGroup id="project-settings-updates" title="Mises à jour">
          <RefinedPanel>
            <RefinedRow title="Mettre à jour ce projet" description="Récupère le dernier code et la dernière version d'Odoo.">
              <Button
                variant="outline"
                disabled={!selectedProjectReady}
                onClick={() => createJob("update_project", { project: selectedProject?.name })}
              >
                <CloudDownload className="h-4 w-4" />
                Mettre à jour
              </Button>
            </RefinedRow>
            <RefinedRow
              className="border-t"
              title="Mettre à jour tous les projets"
              description="Même chose pour chaque projet, l'un après l'autre."
            >
              <Button variant="outline" onClick={() => createJob("update_all")}>
                <CloudDownload className="h-4 w-4" />
                Tout mettre à jour
              </Button>
            </RefinedRow>
          </RefinedPanel>
        </SettingsGroup>
        <SettingsGroup id="project-settings-danger" title="Zone sensible" danger>
          <RefinedPanel className="border-destructive/40 bg-transparent">
            <RefinedRow
              title="Supprimer le projet"
              description={
                <>
                  Le projet est mis de côté dans <code className="text-xs">.odoo_manager_deleted</code>. Il faudra taper
                  son nom pour confirmer.
                </>
              }
            >
              <Button
                variant="outline"
                className="border-destructive/60 text-destructive hover:bg-destructive/10"
                disabled={!selectedProjectReady}
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Supprimer…
              </Button>
            </RefinedRow>
          </RefinedPanel>
        </SettingsGroup>
      </div>
    </TabsContent>
  );
}
