"use client";

import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, RefreshCcw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { normalizeSearchText } from "@/lib/format";
import { socleAppInstalled } from "@/lib/modules";
import type { Job, Project, SocleCatalog, SocleInstallPlan } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PlanModuleChips } from "@/components/modules/module-badges";

type SocleDialogProps = {
  createJob: (action: string, payload?: Record<string, unknown>) => Promise<Job | null>;
  loading: boolean;
  loadingSocleCatalog: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  refreshModules: () => Promise<void>;
  schedule: (callback: () => void | Promise<void>, delay: number) => void;
  selectedDb: string;
  selectedProject: Project | undefined;
  selectedSoclePresets: Set<string>;
  setActiveTab: Dispatch<SetStateAction<string>>;
  setSelectedSoclePresets: Dispatch<SetStateAction<Set<string>>>;
  setSoclePlan: Dispatch<SetStateAction<SocleInstallPlan | null>>;
  setSocleSearch: Dispatch<SetStateAction<string>>;
  socleCatalog: SocleCatalog | null;
  soclePlan: SocleInstallPlan | null;
  soclePlanKey: string;
  soclePresetsToInstall: string[];
  socleSearch: string;
};

export function SocleDialog({ createJob, loading, loadingSocleCatalog, onOpenChange, open, refreshModules, schedule, selectedDb, selectedProject, selectedSoclePresets, setActiveTab, setSelectedSoclePresets, setSoclePlan, setSocleSearch, socleCatalog, soclePlan, soclePlanKey, soclePresetsToInstall, socleSearch }: SocleDialogProps) {
  const [loadingSoclePlan, setLoadingSoclePlan] = useState(false);
  const [soclePlanError, setSoclePlanError] = useState("");
  const visibleSocleApps = useMemo(() => {
    const query = normalizeSearchText(socleSearch.trim());
    const apps = socleCatalog?.apps ?? [];
    if (!query) return apps;
    return apps.filter((app) => normalizeSearchText(`${app.label} ${app.modules.join(" ")}`).includes(query));
  }, [socleCatalog, socleSearch]);
  const soclePlanBlocked = Boolean(soclePlan && (soclePlan.missing.length || soclePlan.uninstallable.length));
  function toggleSoclePreset(presetId: string, checked: boolean) {
    setSelectedSoclePresets((current) => {
      const next = new Set(current);
      if (checked) next.add(presetId);
      else next.delete(presetId);
      return next;
    });
  }
  async function installSelectedSocle() {
    if (!selectedProject || !selectedDb || !soclePresetsToInstall.length || soclePlanBlocked) return;
    const job = await createJob("install_socle", {
      project: selectedProject.name,
      db: selectedDb,
      presets: soclePresetsToInstall.join(","),
    });
    if (job) {
      onOpenChange(false);
      setActiveTab("logs");
      schedule(refreshModules, 2500);
    }
  }
  async function repairEnterpriseLinks() {
    if (!selectedProject) return;
    const job = await createJob("repair_enterprise_links", { project: selectedProject.name });
    if (job) {
      onOpenChange(false);
      setActiveTab("logs");
      schedule(refreshModules, 1500);
    }
  }
  useEffect(() => {
    if (!soclePlanKey || !selectedProject) {
      setSoclePlan(null);
      setSoclePlanError("");
      setLoadingSoclePlan(false);
      return;
    }
    let cancelled = false;
    setLoadingSoclePlan(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ db: selectedDb, presets: soclePlanKey });
      api<SocleInstallPlan>(`/api/projects/${encodeURIComponent(selectedProject.name)}/socle/plan?${params}`)
        .then((plan) => {
          if (cancelled) return;
          setSoclePlan(plan);
          setSoclePlanError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setSoclePlan(null);
          setSoclePlanError(err instanceof Error ? err.message : "Calcul des dépendances impossible.");
        })
        .finally(() => {
          if (!cancelled) setLoadingSoclePlan(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [soclePlanKey, selectedProject, selectedDb]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-5xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Installer un socle Odoo</DialogTitle>
          <DialogDescription>
            Sélectionne les applications à installer dans {selectedDb || "la base choisie"}. Les dépendances et les modules
            qu’Odoo installe automatiquement sont calculés à partir des manifestes du projet.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={socleSearch}
            onChange={(event) => setSocleSearch(event.target.value)}
            placeholder="Rechercher une application ou un module technique"
            aria-label="Rechercher une application"
          />
        </div>
        <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
          {!socleCatalog && loadingSocleCatalog && (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lecture des manifestes du projet…
            </div>
          )}
          {socleCatalog && !socleCatalog.states_available && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
              État des modules de la base indisponible : les modules déjà installés ne peuvent pas être détectés.
            </div>
          )}
          {socleCatalog?.sections.map((section) => {
            const apps = visibleSocleApps.filter((app) => app.section === section.id);
            if (!apps.length) return null;
            return (
              <section key={section.id} aria-labelledby={`socle-section-${section.id}`}>
                <h3 id={`socle-section-${section.id}`} className="mb-2 text-sm font-semibold">{section.label}</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {apps.map((app) => {
                    const unavailable = app.missing.length > 0;
                    const alreadyInstalled = socleAppInstalled(app);
                    return (
                      <label
                        key={app.id}
                        className={cn(
                          "flex min-w-0 items-start gap-3 rounded-md border p-2.5 text-sm transition-colors",
                          unavailable || alreadyInstalled ? "cursor-not-allowed bg-muted/35 opacity-60" : "cursor-pointer hover:bg-hover",
                          selectedSoclePresets.has(app.id) && !alreadyInstalled && "border-primary bg-selected",
                        )}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={alreadyInstalled || selectedSoclePresets.has(app.id)}
                          disabled={unavailable || alreadyInstalled || loading}
                          onCheckedChange={(checked) => toggleSoclePreset(app.id, checked === true)}
                        />
                        <img src={`/odoo-apps/${app.id}.svg`} alt="" aria-hidden="true" className="h-9 w-9 shrink-0 object-contain" />
                        <span className="min-w-0">
                          <span className="block font-medium">{app.label}</span>
                          <span className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground">{app.modules.join(" + ")}</span>
                          {unavailable ? (
                            <span className="mt-0.5 block text-xs text-destructive">Absent de cette version : {app.missing.join(", ")}</span>
                          ) : alreadyInstalled ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">Déjà installé</span>
                          ) : app.extra_count > 0 ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">+ {app.extra_count} module(s) installé(s) avec</span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {socleCatalog && !visibleSocleApps.length && (
            <p className="py-6 text-center text-sm text-muted-foreground">Aucune application ne correspond à la recherche.</p>
          )}
        </div>
        <div className="space-y-3 border-t pt-3">
          <div className="max-h-[20dvh] overflow-y-auto rounded-md border bg-muted/35 p-3 text-sm sm:max-h-[30dvh]" aria-live="polite">
            {!soclePresetsToInstall.length ? (
              <p className="text-muted-foreground">Sélectionne des applications pour voir tout ce qui sera installé.</p>
            ) : loadingSoclePlan && !soclePlan ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Calcul des dépendances…
              </p>
            ) : soclePlanError ? (
              <p className="text-destructive">{soclePlanError}</p>
            ) : soclePlan ? (
              <div className={cn("space-y-2", loadingSoclePlan && "opacity-60")}>
                <div className="font-medium">
                  {soclePlan.total} module(s) seront installés
                  <span className="font-normal text-muted-foreground">
                    {" "}· {soclePlan.requested.length} demandé(s), {soclePlan.dependencies.length} dépendance(s),
                    {" "}{soclePlan.auto_installed.length} automatique(s)
                  </span>
                </div>
                {soclePlan.applications.length > 0 && (
                  <div className="text-xs">
                    <span className="font-medium">Applications ajoutées en plus :</span>{" "}
                    {soclePlan.applications.map((item) => item.title).join(", ")}
                  </div>
                )}
                {(soclePlan.missing.length > 0 || soclePlan.uninstallable.length > 0) && (
                  <div className="text-xs text-destructive">
                    Installation impossible, dépendances introuvables ou non installables :{" "}
                    {[...soclePlan.missing, ...soclePlan.uninstallable].map((item) => `${item.name} (requis par ${item.required_by})`).join(", ")}
                  </div>
                )}
                {soclePlan.dependencies.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">Dépendances ({soclePlan.dependencies.length})</summary>
                    <PlanModuleChips items={soclePlan.dependencies} />
                  </details>
                )}
                {soclePlan.auto_installed.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">
                      Installés automatiquement par Odoo ({soclePlan.auto_installed.length})
                    </summary>
                    <PlanModuleChips items={soclePlan.auto_installed} />
                  </details>
                )}
              </div>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" disabled={!selectedProject || loading} onClick={repairEnterpriseLinks}>
              <RefreshCcw className="h-4 w-4" />
              Vérifier / créer les liens uniquement
            </Button>
            <Button
              disabled={!selectedDb || loading || !soclePresetsToInstall.length || loadingSoclePlan || soclePlanBlocked}
              onClick={installSelectedSocle}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}
              Installer la sélection{soclePlan && soclePresetsToInstall.length ? ` (${soclePlan.total} modules)` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
