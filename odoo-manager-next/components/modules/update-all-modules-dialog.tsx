"use client";

import { type Dispatch, type SetStateAction, useMemo } from "react";
import { AlertTriangle, Info, Loader2, PackageX, RefreshCcw } from "lucide-react";
import { api } from "@/lib/api";
import type { FilestoreStatus, Job, PendingModuleOperation, Project, Toast } from "@/lib/types";
import { cn, delay } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type UpdateAllModulesDialogProps = {
  allowMissingFilestore: boolean;
  applyJobs: (receivedJobs: Job[], notify?: boolean) => void;
  canUseDb: boolean;
  checkingUpdatePrerequisites: boolean;
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  detectedImportedModules: string[];
  loading: boolean;
  missingModulesToIgnore: Set<string>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pushToast: (kind: Toast["kind"], message: string) => void;
  refreshModules: () => Promise<void>;
  requestUpdateAllOdooModules: () => Promise<void>;
  schedule: (callback: () => void | Promise<void>, delay: number) => void;
  selectedDatabaseOrNotify: (action: string) => string;
  selectedDb: string;
  selectedProject: Project | undefined;
  selectedProjectReady: boolean;
  setActiveTab: Dispatch<SetStateAction<string>>;
  setAllowMissingFilestore: Dispatch<SetStateAction<boolean>>;
  setMissingModulesToIgnore: Dispatch<SetStateAction<Set<string>>>;
  setUpdateFilestoreStatus: Dispatch<SetStateAction<FilestoreStatus | null>>;
  setUpdateLocalExcludedModules: Dispatch<SetStateAction<string[]>>;
  setUpdatePendingModules: Dispatch<SetStateAction<PendingModuleOperation[]>>;
  setUpdateScope: Dispatch<SetStateAction<"all" | "imported">>;
  updateFilestoreStatus: FilestoreStatus | null;
  updateLocalExcludedModules: string[];
  updatePendingModules: PendingModuleOperation[];
  updateScope: "all" | "imported";
};

export function UpdateAllModulesDialog({
  allowMissingFilestore,
  applyJobs,
  canUseDb,
  checkingUpdatePrerequisites,
  createJob,
  detectedImportedModules,
  loading,
  missingModulesToIgnore,
  onOpenChange,
  open,
  pushToast,
  refreshModules,
  requestUpdateAllOdooModules,
  schedule,
  selectedDatabaseOrNotify,
  selectedDb,
  selectedProject,
  selectedProjectReady,
  setActiveTab,
  setAllowMissingFilestore,
  setMissingModulesToIgnore,
  setUpdateFilestoreStatus,
  setUpdateLocalExcludedModules,
  setUpdatePendingModules,
  setUpdateScope,
  updateFilestoreStatus,
  updateLocalExcludedModules,
  updatePendingModules,
  updateScope,
}: UpdateAllModulesDialogProps) {
  const pendingModulesWithMissingCode = useMemo(
    () => updatePendingModules.filter((module) => !module.code_available),
    [updatePendingModules],
  );
  const pendingModulesWithAvailableCode = useMemo(
    () => updatePendingModules.filter((module) => module.code_available),
    [updatePendingModules],
  );
  const allMissingPendingModulesSelected =
    pendingModulesWithMissingCode.length > 0 &&
    pendingModulesWithMissingCode.every((module) => missingModulesToIgnore.has(module.name));
  const someMissingPendingModulesSelected =
    pendingModulesWithMissingCode.some((module) => missingModulesToIgnore.has(module.name)) &&
    !allMissingPendingModulesSelected;
  async function waitForJob(jobId: number, timeoutMilliseconds = 960000) {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      const payload = await api<{ jobs: Job[] }>("/api/jobs");
      applyJobs(payload.jobs);
      const current = payload.jobs.find((job) => job.id === jobId);
      if (!current) throw new Error("L'action de démarrage est introuvable dans l'historique.");
      if (current.status === "done") return current;
      if (current.status === "error") {
        const detail = current.lines.filter(Boolean).at(-1) || "Le projet n'a pas pu démarrer.";
        throw new Error(detail);
      }
      await delay(800);
    }
    throw new Error("Le démarrage d'Odoo prend trop de temps. Consulte les logs de l'action.");
  }
  function toggleMissingModuleToIgnore(moduleName: string, checked: boolean) {
    setMissingModulesToIgnore((current) => {
      const next = new Set(current);
      if (checked) next.add(moduleName);
      else next.delete(moduleName);
      return next;
    });
  }
  function toggleAllMissingModulesToIgnore(checked: boolean) {
    setMissingModulesToIgnore(
      checked ? new Set(pendingModulesWithMissingCode.map((module) => module.name)) : new Set(),
    );
  }
  async function ignoreSelectedMissingModulesLocally() {
    const db = selectedDatabaseOrNotify("l'annulation locale des opérations module");
    if (!db || !selectedProject || !missingModulesToIgnore.size) return;
    const modulesToIgnore = Array.from(missingModulesToIgnore).sort();
    const job = await createJob("ignore_missing_modules_locally", {
      project: selectedProject.name,
      db,
      modules: modulesToIgnore.join(","),
    });
    if (job) {
      onOpenChange(false);
      try {
        await waitForJob(job.id);
        pushToast("success", "Les opérations locales ont été annulées. Le précontrôle est actualisé.");
        await refreshModules();
        await requestUpdateAllOdooModules();
      } catch (err) {
        pushToast("error", err instanceof Error ? err.message : "Impossible d’actualiser le précontrôle.");
        setActiveTab("logs");
      }
    }
  }
  async function restoreLocalModuleExclusions() {
    const db = selectedDatabaseOrNotify("la réactivation des mises à jour module");
    if (!db || !selectedProject || !updateLocalExcludedModules.length) return;
    const job = await createJob("restore_module_update_exclusions", {
      project: selectedProject.name,
      db,
      modules: updateLocalExcludedModules.join(","),
    });
    if (job) {
      onOpenChange(false);
      schedule(refreshModules, 1500);
    }
  }
  async function confirmUpdateAllOdooModules() {
    const db = selectedDatabaseOrNotify("la MAJ complète Odoo");
    if (!db || !selectedProject) return;
    const targeted = updateScope === "imported" && detectedImportedModules.length > 0;
    const job = await createJob(
      targeted ? "update_imported_modules" : "update_all_modules",
      targeted
        ? { project: selectedProject.name, db, modules: detectedImportedModules.join(",") }
        : { project: selectedProject.name, db, allow_missing_filestore: allowMissingFilestore },
    );
    if (job) {
      onOpenChange(false);
      schedule(refreshModules, 2500);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) {
          setAllowMissingFilestore(false);
          setUpdateFilestoreStatus(null);
          setUpdatePendingModules([]);
          setUpdateLocalExcludedModules([]);
          setMissingModulesToIgnore(new Set());
        }
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>MAJ complète Odoo</DialogTitle>
          <DialogDescription>
            Choisis la portée de l’opération. Les modules détectés après le dernier import SSH sont proposés en
            priorité.
          </DialogDescription>
        </DialogHeader>
        {detectedImportedModules.length ? (
          <div className="grid gap-3 rounded-md border bg-muted/35 p-3 sm:grid-cols-2">
            <button
              type="button"
              className={cn(
                "rounded-md border p-3 text-left text-sm transition-colors",
                updateScope === "imported"
                  ? "border-primary bg-selected ring-1 ring-primary/25"
                  : "bg-background hover:bg-hover",
              )}
              onClick={() => setUpdateScope("imported")}
            >
              <span className="block font-medium">Modules importés détectés</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Installer ou mettre à jour uniquement {detectedImportedModules.length} module(s).
              </span>
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md border p-3 text-left text-sm transition-colors",
                updateScope === "all"
                  ? "border-primary bg-selected ring-1 ring-primary/25"
                  : "bg-background hover:bg-hover",
              )}
              onClick={() => setUpdateScope("all")}
            >
              <span className="block font-medium">Forcer la MAJ complète</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Exécuter la mise à jour de l’ensemble des modules installés.
              </span>
            </button>
            {updateScope === "imported" && (
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto sm:col-span-2">
                {detectedImportedModules.map((moduleName) => (
                  <Badge key={moduleName} variant="outline" className="bg-background font-mono">
                    {moduleName}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <div className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm">
          <div className="grid gap-1">
            <span className="text-xs font-medium uppercase text-muted-foreground">Projet</span>
            <span className="break-words font-medium">{selectedProject?.name || "-"}</span>
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-medium uppercase text-muted-foreground">Base</span>
            <span className="break-words font-medium">{selectedDb || "-"}</span>
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-medium uppercase text-muted-foreground">Commande</span>
            <code className="break-all rounded bg-slate-950 px-2 py-1 text-xs text-emerald-100">
              {updateScope === "imported" && detectedImportedModules.length
                ? `odoo -d ${selectedDb || "BASE"} -i/-u ${detectedImportedModules.join(",")} --stop-after-init`
                : `odoo -d ${selectedDb || "BASE"} -u ${updateLocalExcludedModules.length ? "<modules disponibles non exclus>" : "all"} --stop-after-init`}
            </code>
          </div>
        </div>
        {updateScope === "all" && updateLocalExcludedModules.length ? (
          <div className="grid gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-800 dark:bg-blue-950/45 dark:text-blue-100">
            <div className="font-medium">Mode avec exceptions locales</div>
            <p>
              Le gestionnaire utilisera une liste explicite des modules dont le code est disponible. Les modules
              suivants ne seront pas remis en attente par un nouvel appel à <code>-u all</code> :
            </p>
            <div className="flex flex-wrap gap-1.5">
              {updateLocalExcludedModules.map((moduleName) => (
                <Badge
                  key={moduleName}
                  variant="outline"
                  className="border-blue-300 bg-white font-mono text-blue-950 dark:border-blue-700 dark:bg-blue-950/70 dark:text-blue-100"
                >
                  {moduleName}
                </Badge>
              ))}
            </div>
            <Button
              variant="outline"
              className="border-blue-300 bg-white hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/70 dark:hover:bg-blue-900/70"
              onClick={restoreLocalModuleExclusions}
              disabled={loading}
            >
              <RefreshCcw className="h-4 w-4" />
              Réactiver toutes les exclusions
            </Button>
          </div>
        ) : null}
        {updateScope === "all" && pendingModulesWithAvailableCode.length ? (
          <div className="grid gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-800 dark:bg-blue-950/45 dark:text-blue-100">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="grid gap-1">
                <span className="font-medium">Opérations Odoo à terminer</span>
                <span>
                  Une installation ou une mise à jour précédente a laissé {pendingModulesWithAvailableCode.length}{" "}
                  module(s) en attente. Leur code est présent : la mise à jour complète peut les reprendre
                  automatiquement.
                </span>
              </div>
            </div>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {pendingModulesWithAvailableCode.map((module) => (
                <Badge
                  key={module.name}
                  variant="outline"
                  className="border-blue-300 bg-white font-mono text-blue-950 dark:border-blue-700 dark:bg-blue-950/70 dark:text-blue-100"
                >
                  {module.name} · {module.state}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {updateScope === "all" && pendingModulesWithMissingCode.length ? (
          <div className="grid gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-800 dark:bg-red-950/45 dark:text-red-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div className="grid gap-1">
                <span className="font-medium">
                  Code source manquant pour {pendingModulesWithMissingCode.length} module(s)
                </span>
                <span>
                  Odoo avait prévu de les installer, mettre à jour ou supprimer, mais leur dossier n’existe plus dans le
                  projet. Restaure leur code si tu veux conserver l’opération. Sur une copie locale de test, tu peux
                  aussi annuler leur opération sans désinstaller les modules déjà actifs.
                </span>
                <span>
                  Les modules qui en dépendent seront détectés et exclus automatiquement de cette mise à jour locale
                  afin de conserver un ensemble cohérent.
                </span>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-red-200 bg-white px-3 py-2 font-medium dark:border-red-800 dark:bg-red-950/55">
              <Checkbox
                color="red"
                checked={someMissingPendingModulesSelected ? "indeterminate" : allMissingPendingModulesSelected}
                disabled={loading}
                onCheckedChange={(checked) => toggleAllMissingModulesToIgnore(checked === true)}
              />
              Tout sélectionner ({pendingModulesWithMissingCode.length})
            </label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-red-200 bg-white p-2 dark:border-red-800 dark:bg-red-950/55">
              {pendingModulesWithMissingCode.map((module) => (
                <label
                  key={module.name}
                  className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-red-50 dark:hover:bg-red-900/50"
                >
                  <Checkbox
                    color="red"
                    checked={missingModulesToIgnore.has(module.name)}
                    onCheckedChange={(checked) => toggleMissingModuleToIgnore(module.name, checked === true)}
                  />
                  <span className="min-w-0 flex-1 break-all font-mono text-xs">{module.name}</span>
                  <Badge className="shrink-0" variant="destructive">
                    {module.state} · code absent
                  </Badge>
                </label>
              ))}
            </div>
            <Button
              variant="destructive"
              disabled={!missingModulesToIgnore.size || loading}
              onClick={ignoreSelectedMissingModulesLocally}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageX className="h-4 w-4" />}
              Annuler localement {missingModulesToIgnore.size || "la sélection"} opération(s)
            </Button>
            <p className="text-xs text-red-800 dark:text-red-200">
              Cette action ne désinstalle aucun module et ne supprime aucune donnée. Le détail des exclusions
              automatiques apparaîtra dans les logs.
            </p>
          </div>
        ) : null}
        {updateScope === "all" && updateFilestoreStatus && updateFilestoreStatus.missing > 0 ? (
          <div className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="grid gap-1">
                <span className="font-medium">Filestore incomplet</span>
                <span>
                  {updateFilestoreStatus.missing.toLocaleString("fr-FR")} fichier(s) manquent. Leur téléchargement
                  n&apos;est pas nécessaire pour mettre à jour les modules : aucune référence ne sera supprimée, mais
                  les médias absents resteront indisponibles.
                </span>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-300 bg-white p-3 hover:bg-amber-100/60 dark:border-amber-800 dark:bg-amber-950/55 dark:hover:bg-amber-900/50">
              <Checkbox
                className="mt-0.5"
                checked={allowMissingFilestore}
                onCheckedChange={(checked) => setAllowMissingFilestore(checked === true)}
              />
              <span className="font-medium">Continuer sans télécharger le filestore</span>
            </label>
          </div>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={
              !selectedProjectReady ||
              !canUseDb ||
              loading ||
              checkingUpdatePrerequisites ||
              Boolean(updateScope === "all" && pendingModulesWithMissingCode.length) ||
              Boolean(updateScope === "all" && updateFilestoreStatus?.missing && !allowMissingFilestore)
            }
            onClick={confirmUpdateAllOdooModules}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {updateScope === "imported" && detectedImportedModules.length
              ? "Traiter les modules importés"
              : "Lancer la MAJ complète"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
