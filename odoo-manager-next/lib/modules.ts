import type { ModuleOrigin, SocleApp } from "@/lib/types";

export function socleAppInstalled(app: SocleApp) {
  return app.missing.length === 0 && app.installed_modules.length === app.modules.length;
}

export function normalizedModuleOrigin(origin?: string, sourcePath?: string): ModuleOrigin {
  if (origin === "enterprise" || origin === "odoo") return origin;
  const normalizedPath = (sourcePath || "").replace(/\\/g, "/").toLowerCase();
  if (
    normalizedPath.includes("/addons-store/odoo_entreprise/") ||
    normalizedPath.includes("/addons-store/odoo_enterprise/")
  )
    return "enterprise";
  // Réponse d'un ancien backend, qui ne distinguait pas le code standard d'Odoo.
  if (!origin && normalizedPath.includes("/odoo/odoo/addons/")) return "odoo";
  return "other";
}

/** Filtres d'état de l'onglet Modules, dans l'ordre des pastilles. */
export const MODULE_STATUS_FILTERS = [
  { value: "all", label: "Tous" },
  { value: "installed", label: "Installés" },
  { value: "to upgrade", label: "À mettre à jour" },
  { value: "uninstalled", label: "Disponibles" },
] as const;

export function moduleMatchesStatus(state: string | undefined, status: string) {
  // L'ancien backend renvoie « disponible » pour un module non installé.
  return status === "all" || state === status || (status === "uninstalled" && state === "disponible");
}

/** Nombre de modules pour chaque filtre d'état, affiché sur les pastilles. */
export function countModulesByStatus(modules: { state?: string }[]) {
  return Object.fromEntries(
    MODULE_STATUS_FILTERS.map(({ value }) => [
      value,
      modules.filter((module) => moduleMatchesStatus(module.state, value)).length,
    ]),
  ) as Record<(typeof MODULE_STATUS_FILTERS)[number]["value"], number>;
}

const MODULE_ORIGIN_LABELS: Record<ModuleOrigin, string> = {
  odoo: "Odoo Community",
  enterprise: "Odoo Enterprise",
  other: "Autre",
};

export function moduleOriginLabel(origin: ModuleOrigin) {
  return MODULE_ORIGIN_LABELS[origin];
}

export function moduleRepositoryUrlError(value: string) {
  const rawUrl = value.trim();
  if (!rawUrl) return "";
  const validSshUrl = /^(?:ssh:\/\/git@gitlab\.sudokeys\.com:10022\/|git@gitlab\.sudokeys\.com:)[A-Za-z0-9._/-]+\.git$/;
  return validSshUrl.test(rawUrl)
    ? ""
    : "Utilise l’URL SSH du dépôt GitLab Sudokeys, par exemple ssh://git@gitlab.sudokeys.com:10022/equipe/depot.git.";
}
