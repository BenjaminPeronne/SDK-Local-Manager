import type { InstallGuide, ManagerSettings, Overview, Project, ProjectDiagnostics, SystemStatus } from "@/lib/types";

export function offlineDockerGuide(): InstallGuide {
  const platform = typeof navigator === "undefined" ? "" : navigator.userAgent.toLowerCase();
  if (platform.includes("windows")) {
    return {
      title: "Installer Docker Desktop pour Windows",
      download_url: "https://www.docker.com/products/docker-desktop/",
      install_url: "https://docs.docker.com/desktop/setup/install/windows-install/",
      steps: [
        "Télécharge Docker Desktop pour Windows depuis le site officiel Docker.",
        "Installe Docker Desktop avec le backend WSL 2 activé.",
        "Redémarre Windows si demandé, lance Docker Desktop, puis clique sur Actualiser.",
      ],
    };
  }
  if (platform.includes("mac")) {
    return {
      title: "Installer Docker Desktop pour Mac",
      download_url: "https://www.docker.com/products/docker-desktop/",
      install_url: "https://docs.docker.com/desktop/setup/install/mac-install/",
      steps: [
        "Télécharge Docker Desktop pour Mac depuis le site officiel Docker.",
        "Ouvre le fichier .dmg, place Docker dans Applications, puis lance Docker Desktop.",
        "Attends que Docker soit démarré, puis clique sur Actualiser.",
      ],
    };
  }
  return {
    title: "Installer Docker",
    download_url: "https://www.docker.com/products/docker-desktop/",
    install_url: "https://docs.docker.com/desktop/setup/install/linux/",
    steps: [
      "Installe Docker Desktop ou Docker Engine selon ta distribution.",
      "Lance Docker et vérifie que la commande docker info répond.",
      "Reviens dans le gestionnaire puis clique sur Actualiser.",
    ],
  };
}

export function formatDiagnostics(payload: ProjectDiagnostics) {
  const lines = [
    `Diagnostic projet: ${payload.project}`,
    `Docker: ${payload.docker_ok ? "ok" : "indisponible"}`,
    `Odoo: ${payload.odoo_status || "-"}`,
    `PostgreSQL: ${payload.postgres_status || "-"}`,
    "",
  ];

  if (payload.databases?.length) {
    lines.push("Bases:");
    for (const database of payload.databases) {
      lines.push(`- ${database.name}`);
      if (database.filestore) {
        lines.push(
          `  Filestore: ${database.filestore.actual}/${database.filestore.referenced_unique} fichier(s) unique(s) présents`,
        );
        lines.push(`  Fichiers manquants: ${database.filestore.missing}`);
        lines.push(`  Chemin: ${database.filestore.path}`);
      }
    }
    lines.push("");
  }

  lines.push("Points détectés:");
  for (const issue of payload.issues || []) {
    lines.push(`[${issue.severity.toUpperCase()}] ${issue.title}`);
    if (issue.details) lines.push(issue.details);
    for (const item of issue.items || []) {
      lines.push(`  - ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function firstOdooDatabase(project?: Project) {
  return project?.databases?.find((db) => db !== "postgres") || "";
}

/** `1` active le mode développeur d'Odoo, `assets` sert en plus les fichiers JS et CSS non minifiés. */
export type OdooDebugMode = "1" | "assets";

export function odooAccessUrl(project?: Project, db?: string, debug?: OdooDebugMode) {
  if (!project?.url) return "#";
  const database = db && db !== "postgres" ? db : "";
  if (!database && !debug) return project.url;
  const params = new URLSearchParams();
  if (database) params.set("db", database);
  if (debug) params.set("debug", debug);
  try {
    const url = new URL("/web", project.url);
    url.search = params.toString();
    return url.toString();
  } catch {
    return `${project.url.replace(/\/$/, "")}/web?${params.toString()}`;
  }
}

export function fallbackManagerSettings(
  current: ManagerSettings | null,
  overview: Overview | null,
  systemStatus: SystemStatus | null,
): ManagerSettings {
  return {
    version: current?.version ?? 1,
    workspace: current?.workspace || systemStatus?.workspace || overview?.workspace || "",
    execution_mode: current?.execution_mode || systemStatus?.docker.execution_mode || "native",
    wsl_distribution: current?.wsl_distribution || "",
    docker_executable: current?.docker_executable || "docker",
    traefik_directory: current?.traefik_directory || systemStatus?.traefik?.path || "",
    allowed_origins: current?.allowed_origins ?? [],
    active_browser_origins: current?.active_browser_origins,
    docker_poll_interval: current?.docker_poll_interval || 10,
    api_port: current?.api_port || 18765,
    api_port_actual: current?.api_port_actual,
    show_technical_details: current?.show_technical_details ?? false,
    sticky_header: current?.sticky_header ?? false,
    interface_icon: current?.interface_icon === "local" ? "local" : "manager",
    interface_layout: current?.interface_layout === "classic" ? "classic" : "refined",
    seasonal_decorations: current?.seasonal_decorations ?? true,
    onboarding_completed: current?.onboarding_completed ?? false,
    legacy_workspace: current?.legacy_workspace || "",
    migration_banner_dismissed: current?.migration_banner_dismissed ?? false,
    beta_interface_banner_dismissed: current?.beta_interface_banner_dismissed ?? false,
    config_file: current?.config_file,
    platform: current?.platform || systemStatus?.docker.platform || "",
    workspace_exists: current?.workspace_exists ?? systemStatus?.workspace_exists,
  };
}

/** `/mnt/d/Projets` → `D:\\Projets` : un chemin du disque Windows, affiché comme Windows l'écrit. */
export function windowsPathFromMount(path: string) {
  const match = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(path);
  if (!match) return path;
  return `${match[1].toUpperCase()}:\\${(match[2] || "").replace(/\//g, "\\")}`;
}
