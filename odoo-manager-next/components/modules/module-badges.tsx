import type { PlanModule, RepositoryModule } from "@/lib/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

export function RepositoryModuleVersion({ module }: { module: RepositoryModule }) {
  if (module.action === "update" && module.current_version && module.version && module.current_version !== module.version) {
    return (
      <span className="font-mono text-xs tabular-nums">
        <span className="text-muted-foreground">{module.current_version}</span>
        <span className="mx-1 text-muted-foreground">→</span>
        <span className="font-medium">{module.version}</span>
      </span>
    );
  }
  return <span className="font-mono text-xs tabular-nums text-muted-foreground">{module.version || "—"}</span>;
}

export function RepositoryModuleStatus({ module }: { module: RepositoryModule }) {
  if (module.action === "blocked") return <Badge variant="outline" className="shrink-0">Bloqué</Badge>;
  if (module.action === "add") return <Badge variant="success" className="shrink-0">Nouveau</Badge>;
  const same = Boolean(module.current_version && module.current_version === module.version);
  return <Badge variant="default" className="shrink-0">{same ? "Réimport" : "Mise à jour"}</Badge>;
}

export function PlanModuleChips({ items }: { items: PlanModule[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item.name}
          className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] leading-4"
          title={item.title !== item.name ? item.title : undefined}
        >
          {item.name}
        </span>
      ))}
    </div>
  );
}

// La couleur porte l'état : vert installé, ambre opération Odoo en attente,
// rouge suppression en attente, gris neutre pour ce qui ne demande rien.
const MODULE_STATE_BADGES: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
  installed: { label: "Installé", variant: "success" },
  "to install": { label: "À installer", variant: "warning" },
  "to upgrade": { label: "À mettre à jour", variant: "warning" },
  "to remove": { label: "À désinstaller", variant: "danger" },
  uninstallable: { label: "Non installable", variant: "outline" },
  uninstalled: { label: "Disponible", variant: "secondary" },
  disponible: { label: "Disponible", variant: "secondary" },
};

export function ModuleStateBadge({ state }: { state: string }) {
  const badge = MODULE_STATE_BADGES[state] ?? { label: state || "-", variant: "secondary" };
  return (
    <Badge className="shrink-0" variant={badge.variant} title={`État Odoo : ${state || "inconnu"}`}>
      {badge.label}
    </Badge>
  );
}
