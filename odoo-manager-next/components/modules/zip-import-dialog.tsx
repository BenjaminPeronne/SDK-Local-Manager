"use client";

import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import { FileArchive, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ExternalLogView, Job, Project, Toast, ZipInspection } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilePicker } from "@/components/ui/file-picker";

type ZipImportDialogProps = {
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pushToast: (kind: Toast["kind"], message: string) => void;
  refreshJobs: (detailJobId?: number | null) => Promise<void>;
  refreshModules: () => Promise<void>;
  schedule: (callback: () => void | Promise<void>, delay: number) => void;
  selectedProject: Project | undefined;
  setExternalLogView: Dispatch<SetStateAction<ExternalLogView | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setSelectedJobId: Dispatch<SetStateAction<number | null>>;
};

export function ZipImportDialog({
  loading,
  onOpenChange,
  open,
  pushToast,
  refreshJobs,
  refreshModules,
  schedule,
  selectedProject,
  setExternalLogView,
  setLoading,
  setSelectedJobId,
}: ZipImportDialogProps) {
  const [replaceZipModules, setReplaceZipModules] = useState(true);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipModuleCandidates, setZipModuleCandidates] = useState<string[]>([]);
  const [selectedZipModules, setSelectedZipModules] = useState<Set<string>>(new Set());
  const [inspectingZip, setInspectingZip] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const zipInspectionGeneration = useRef(0);
  async function importZip() {
    if (!selectedProject) return;
    const file = zipInputRef.current?.files?.[0];
    if (!file) {
      pushToast("error", "Sélectionne un fichier ZIP.");
      return;
    }
    const selected = Array.from(selectedZipModules).sort();
    if (!selected.length) {
      pushToast("error", "Sélectionne au moins un module à importer.");
      return;
    }
    const form = new FormData();
    form.append("zip", file);
    form.append("replace_existing", replaceZipModules ? "1" : "0");
    form.append("modules", selected.join(","));
    setLoading(true);
    try {
      const result = await api<{ job: Job }>(`/api/projects/${encodeURIComponent(selectedProject.name)}/module-zip`, {
        method: "POST",
        body: form,
      });
      setSelectedJobId(result.job.id);
      setExternalLogView(null);
      onOpenChange(false);
      resetZipImport();
      pushToast("success", `Import de ${selected.length} module(s) lancé.`);
      schedule(refreshModules, 1800);
      await refreshJobs();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Import ZIP impossible.");
    } finally {
      setLoading(false);
    }
  }
  function resetZipImport() {
    zipInspectionGeneration.current += 1;
    setZipFile(null);
    setZipModuleCandidates([]);
    setSelectedZipModules(new Set());
    setInspectingZip(false);
    if (zipInputRef.current) zipInputRef.current.value = "";
  }
  async function inspectZipFile(file?: File) {
    const generation = ++zipInspectionGeneration.current;
    setZipFile(file || null);
    setZipModuleCandidates([]);
    setSelectedZipModules(new Set());
    if (!file || !selectedProject) {
      setInspectingZip(false);
      return;
    }

    const form = new FormData();
    form.append("zip", file);
    setInspectingZip(true);
    try {
      const result = await api<ZipInspection>(
        `/api/projects/${encodeURIComponent(selectedProject.name)}/module-zip/inspect`,
        { method: "POST", body: form },
      );
      if (generation !== zipInspectionGeneration.current) return;
      setZipModuleCandidates(result.modules);
      setSelectedZipModules(new Set(result.modules));
      if (!result.modules.length) {
        pushToast("error", "Aucun module Odoo détecté dans cette archive.");
      } else if (result.ignored_symlinks) {
        pushToast(
          "info",
          `${result.modules.length} module(s) détecté(s). ${result.ignored_symlinks} lien(s) de packaging ignoré(s).`,
        );
      }
    } catch (err) {
      if (generation !== zipInspectionGeneration.current) return;
      pushToast("error", err instanceof Error ? err.message : "Analyse du ZIP impossible.");
    } finally {
      if (generation === zipInspectionGeneration.current) setInspectingZip(false);
    }
  }
  function toggleZipModule(moduleName: string, checked: boolean) {
    setSelectedZipModules((current) => {
      const next = new Set(current);
      if (checked) next.add(moduleName);
      else next.delete(moduleName);
      return next;
    });
  }
  function toggleAllZipModules(checked: boolean) {
    setSelectedZipModules(checked ? new Set(zipModuleCandidates) : new Set());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) resetZipImport();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importer un ZIP de modules</DialogTitle>
          <DialogDescription>
            Analyse l’archive, choisis les modules à copier dans addons-store, puis confirme l’import.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FilePicker
            ref={zipInputRef}
            accept=".zip"
            file={zipFile}
            buttonLabel="Choisir un ZIP"
            disabled={loading || inspectingZip}
            onChange={(event) => void inspectZipFile(event.target.files?.[0])}
          />
          {inspectingZip && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyse sécurisée de l’archive…
            </div>
          )}
          {!inspectingZip && zipModuleCandidates.length > 0 && (
            <div className="min-w-0 rounded-md border">
              <label className="flex cursor-pointer items-start gap-3 border-b bg-muted/40 p-3 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={
                    selectedZipModules.size > 0 && selectedZipModules.size < zipModuleCandidates.length
                      ? "indeterminate"
                      : selectedZipModules.size === zipModuleCandidates.length
                  }
                  onCheckedChange={(checked) => toggleAllZipModules(checked === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Sélectionner tous les modules détectés</span>
                  <span className="block text-xs text-muted-foreground">
                    {selectedZipModules.size}/{zipModuleCandidates.length} module(s) sélectionné(s)
                  </span>
                </span>
              </label>
              <div className="max-h-64 overflow-y-auto p-2">
                {zipModuleCandidates.map((moduleName) => (
                  <label
                    key={moduleName}
                    className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md p-2 text-sm hover:bg-hover"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedZipModules.has(moduleName)}
                      onCheckedChange={(checked) => toggleZipModule(moduleName, checked === true)}
                    />
                    <span className="min-w-0 break-all font-mono">{moduleName}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <label className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <Checkbox
              className="mt-1"
              checked={replaceZipModules}
              onCheckedChange={(checked) => setReplaceZipModules(checked === true)}
            />
            <span>
              <span className="block font-medium">Remplacer les modules existants</span>
              <span className="block text-xs text-muted-foreground">
                L’ancien dossier ou lien est sauvegardé dans `.odoo_manager_backups` avant remplacement.
              </span>
            </span>
          </label>
          <Button onClick={importZip} disabled={loading || inspectingZip || !selectedZipModules.size}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
            Importer {selectedZipModules.size || ""} module(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
