import type { ModuleOrigin, SocleApp } from "@/lib/types";

export function socleAppInstalled(app: SocleApp) {
  return app.missing.length === 0 && app.installed_modules.length === app.modules.length;
}

export function normalizedModuleOrigin(origin?: string, sourcePath?: string): ModuleOrigin {
  if (origin === "enterprise") return "enterprise";
  const normalizedPath = (sourcePath || "").replace(/\\/g, "/").toLowerCase();
  return normalizedPath.includes("/addons-store/odoo_entreprise/") ||
    normalizedPath.includes("/addons-store/odoo_enterprise/")
    ? "enterprise"
    : "other";
}

export function moduleOriginLabel(origin: ModuleOrigin) {
  return origin === "enterprise" ? "Odoo Enterprise" : "Autre";
}

export function moduleRepositoryUrlError(value: string) {
  const rawUrl = value.trim();
  if (!rawUrl) return "";
  const validSshUrl = /^(?:ssh:\/\/git@gitlab\.sudokeys\.com:10022\/|git@gitlab\.sudokeys\.com:)[A-Za-z0-9._/-]+\.git$/;
  return validSshUrl.test(rawUrl)
    ? ""
    : "Utilise l’URL SSH du dépôt GitLab Sudokeys, par exemple ssh://git@gitlab.sudokeys.com:10022/equipe/depot.git.";
}
