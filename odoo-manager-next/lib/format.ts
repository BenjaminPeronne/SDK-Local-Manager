const NAME_LIST = new Intl.ListFormat("fr", { style: "long", type: "conjunction" });

export function formatNameList(names: string[]) {
  return NAME_LIST.format(names);
}

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function statusVariant(status: string): "success" | "warning" | "outline" | "destructive" | "secondary" {
  if (status === "running" || status === "healthy" || status === "done") return "success";
  if (status === "error") return "destructive";
  if (status === "exited" || status === "created" || status === "cancelling") return "warning";
  if (status === "cancelled") return "outline";
  return "secondary";
}

export function statusLabel(status: string) {
  if (status === "running") return "En cours";
  if (status === "done") return "Terminée";
  if (status === "error") return "Erreur";
  if (status === "queued") return "En attente";
  if (status === "cancelling") return "Arrêt en cours";
  if (status === "cancelled") return "Arrêtée";
  return status;
}

export function compactWorkspacePath(path: string | undefined, workspace: string | undefined) {
  if (!path) return "";
  if (!workspace) return path;
  return path.replace(`${workspace.replace(/\/$/, "")}/`, "");
}

const BYTE_UNITS = ["o", "Ko", "Mo", "Go", "To"];

/** Taille lisible en unités binaires, comme le Finder : 1,5 Go, 820 Mo. */
export function formatBytes(bytes: number) {
  let value = Math.max(0, bytes || 0);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 3 && value < 100 ? 1 : 0;
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: digits })} ${BYTE_UNITS[unit]}`;
}
