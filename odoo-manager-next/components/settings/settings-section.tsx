import type { HTMLAttributes, ReactNode } from "react";
import { Bug, FolderOpen, KeyRound, Palette, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export const SETTINGS_SECTIONS = [
  { id: "general", label: "Général", icon: FolderOpen },
  { id: "appearance", label: "Apparence", icon: Palette },
  { id: "accounts", label: "Comptes et accès", icon: KeyRound },
  { id: "advanced", label: "Avancé", icon: SlidersHorizontal },
  { id: "diagnostic", label: "Diagnostic", icon: Bug },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export const SETTINGS_SAVED_KEYS = [
  "workspace",
  "docker_executable",
  "traefik_directory",
  "docker_poll_interval",
  "api_port",
  "show_technical_details",
  "sticky_header",
  "interface_icon",
  "interface_layout",
  "migration_banner_dismissed",
  "beta_interface_banner_dismissed",
] as const;

export function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function SettingsGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-4 rounded-md border bg-card p-4", className)} {...props} />;
}
