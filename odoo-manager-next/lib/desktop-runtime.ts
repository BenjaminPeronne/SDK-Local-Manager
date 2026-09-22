import { jobCompletionTitle } from "@/lib/jobs";
import type { Job } from "@/lib/types";
import packageMetadata from "../package.json";

export const FALLBACK_APP_VERSION = packageMetadata.version;

export function isDesktopRuntime() {
  return typeof window !== "undefined" && Boolean(window.sdkDesktop);
}

export async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = window.sdkDesktop;
  if (!bridge) throw new Error("L’intégration native Electron est indisponible.");
  switch (command) {
    case "backend_endpoint": return await bridge.backendEndpoint() as T;
    case "backend_diagnostics": return await bridge.backendDiagnostics() as T;
    case "open_external_url": return await bridge.openExternalUrl(String(args?.url || "")) as T;
    case "open_docker_desktop": return await bridge.openDockerDesktop() as T;
    default: throw new Error("Commande native inconnue.");
  }
}

export async function applicationVersion() {
  if (!isDesktopRuntime()) return FALLBACK_APP_VERSION;
  try {
    return await window.sdkDesktop!.getVersion();
  } catch {
    return FALLBACK_APP_VERSION;
  }
}

export async function openExternalUrl(url?: string) {
  if (!url || url === "#") return false;
  if (!isDesktopRuntime()) {
    return Boolean(window.open(url, "_blank", "noopener,noreferrer"));
  }
  await invokeDesktop<void>("open_external_url", { url });
  return true;
}

export async function openDockerDesktopNative() {
  await invokeDesktop<void>("open_docker_desktop");
}

export async function pickDirectory(defaultPath?: string) {
  if (!isDesktopRuntime()) return null;
  return window.sdkDesktop!.pickDirectory(defaultPath || undefined);
}

export async function requestTaskNotificationPermission() {
  if (isDesktopRuntime()) {
    return window.sdkDesktop!.notificationsSupported();
  }
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (window.Notification.permission === "granted") return true;
  if (window.Notification.permission === "denied") return false;
  return (await window.Notification.requestPermission()) === "granted";
}

export async function sendTaskNotification(job: Job) {
  const successful = job.status === "done";
  const title = jobCompletionTitle(job);
  const body = !successful && job.error_message ? `${job.title}\n${job.error_message}` : job.title;
  if (isDesktopRuntime()) {
    await window.sdkDesktop!.notify(title, body);
    return;
  }
  if (typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "granted") {
    new window.Notification(title, { body });
  }
}
