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
