"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { isJobUnfinished } from "@/lib/jobs";
import type { Job, Toast } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmButton } from "@/components/settings/disk-usage-panel";
import { SettingsSection } from "@/components/settings/settings-section";

/**
 * Le backend arrête d'abord les conteneurs et efface ce qu'ils ont écrit (dossiers que le
 * système refuse de supprimer à la main sous Linux) ; l'application se retire ensuite.
 */
export function UninstallPanel({
  createJob,
  jobs,
  pushToast,
}: {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  jobs: Job[];
  pushToast: (kind: Toast["kind"], message: string) => void;
}) {
  const [deleteProjects, setDeleteProjects] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const handled = useRef<number | null>(null);
  const job = jobs.find((entry) => entry.id === jobId);
  const busy = jobId !== null && (!job || isJobUnfinished(job) || job.status === "done");

  useEffect(() => {
    if (!job || isJobUnfinished(job) || handled.current === job.id) return;
    handled.current = job.id;
    if (job.status === "done") void window.sdkDesktop?.uninstall?.(deleteProjects);
    else pushToast("error", "La désinstallation s’est arrêtée : regarde le détail dans l’activité.");
  }, [job, deleteProjects, pushToast]);

  return (
    <SettingsSection
      title="Désinstaller"
      description="Retire l’application de cet ordinateur, avec ce qu’elle a installé et ses réglages."
    >
      <div className="grid gap-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Les projets sont arrêtés, ainsi que l’accès aux projets par leur adresse et les outils de test des e-mails et
          de la box IoT. La corbeille des projets, les réglages et les accès enregistrés sont effacés, puis
          l’application se retire et se ferme.
        </p>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={deleteProjects}
            disabled={busy}
            onCheckedChange={(checked) => setDeleteProjects(checked === true)}
          />
          <span className="min-w-0">
            <span className="block font-medium">Supprimer aussi mes projets et leurs bases</span>
            <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
              Décoché, le dossier des projets reste sur le disque. Coché, tout part définitivement.
            </span>
          </span>
        </label>
        <div>
          {busy ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Désinstallation en cours…
            </span>
          ) : (
            <ConfirmButton
              label="Désinstaller"
              confirmLabel={deleteProjects ? "Confirmer : tout supprimer" : "Confirmer la désinstallation"}
              icon={<Trash2 className="h-4 w-4" />}
              onConfirm={() =>
                void createJob("uninstall", { delete_projects: deleteProjects }).then((created) =>
                  setJobId(created?.id ?? null),
                )
              }
            />
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
