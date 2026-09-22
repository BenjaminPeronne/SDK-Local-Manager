import { invokeDesktop, isDesktopRuntime } from "@/lib/desktop-runtime";
import type { Job, RestoreDatabasePayload } from "@/lib/types";

export let API_BASE = process.env.NEXT_PUBLIC_ODOO_MANAGER_API?.replace(/\/$/, "") || "";

const DESKTOP_API_RETRY_DELAYS_MS = [0, 250, 750, 1500, 2500];

const API_TIMEOUT_MS = 20_000;

const UPLOAD_TIMEOUT_MS = 120_000;

// Lectures qui parcourent tous les addons du projet : sous Windows avec WSL, elles peuvent
// dépasser 20 s sans que le service local soit en panne.
const SLOW_READ_TIMEOUT_MS = 90_000;

function apiTimeoutFor(path: string) {
  if (path.includes("/module-zip") || path.endsWith("/repository/inspect")) return UPLOAD_TIMEOUT_MS;
  if (/\/api\/projects\/[^/]+\/(modules|socle)(\?|\/|$)/.test(path)) return SLOW_READ_TIMEOUT_MS;
  return API_TIMEOUT_MS;
}

export class ApiUnavailableError extends Error {
  constructor(
    message = `Service local SDK Local Manager indisponible. L'application n'arrive pas à joindre l'API locale ${API_BASE || "http://127.0.0.1:18765"}.`,
  ) {
    super(message);
    this.name = "ApiUnavailableError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response | undefined;
  const retryDelays = isDesktopRuntime() ? DESKTOP_API_RETRY_DELAYS_MS : [0];
  try {
    for (const [index, delay] of retryDelays.entries()) {
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
      const controller = new AbortController();
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, apiTimeoutFor(path));
      try {
        response = await fetch(`${API_BASE}${path}`, {
          ...init,
          cache: "no-store",
          headers:
            init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
          signal: controller.signal,
        });
        break;
      } catch (error) {
        if (timedOut) throw new ApiUnavailableError("Le service local ne répond pas dans le délai attendu.");
        if (index === retryDelays.length - 1) throw error;
      } finally {
        window.clearTimeout(timeout);
      }
    }
  } catch (error) {
    if (error instanceof ApiUnavailableError) throw error;
    throw new ApiUnavailableError();
  }
  if (!response) throw new ApiUnavailableError();
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    // Sans message du serveur, on garde au moins la requête fautive : un « Bad Request » seul n'est pas diagnosticable.
    const method = (init?.method || "GET").toUpperCase();
    throw new Error(payload.error || `${method} ${path} : ${response.status} ${response.statusText}`);
  }
  return payload as T;
}

export function uploadDatabaseBackup(
  payload: RestoreDatabasePayload,
  onProgress: (progress: number) => void,
): Promise<{ job: Job }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_BASE}/api/projects/${encodeURIComponent(payload.project)}/database-restore`);
    request.setRequestHeader("Content-Type", "application/zip");
    request.setRequestHeader("X-Odoo-Database-Name", encodeURIComponent(payload.db));
    request.setRequestHeader("X-Odoo-Master-Password", encodeURIComponent(payload.masterPwd));
    request.setRequestHeader("X-Odoo-Copy", payload.copy ? "1" : "0");
    request.setRequestHeader("X-Odoo-Neutralize", payload.neutralize ? "1" : "0");
    request.setRequestHeader("X-File-Name", encodeURIComponent(payload.file.name));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded * 100) / event.total)));
      }
    };
    request.onerror = () => reject(new ApiUnavailableError("Le téléversement de la sauvegarde a échoué."));
    request.onabort = () => reject(new Error("Le téléversement de la sauvegarde a été annulé."));
    request.onload = () => {
      let response: { job?: Job; error?: string } = {};
      try {
        response = request.responseText ? JSON.parse(request.responseText) : {};
      } catch {
        reject(new Error("Le backend a renvoyé une réponse de restauration illisible."));
        return;
      }
      if (request.status < 200 || request.status >= 300 || !response.job) {
        reject(new Error(response.error || `La restauration a été refusée (HTTP ${request.status}).`));
        return;
      }
      onProgress(100);
      resolve({ job: response.job });
    };
    request.send(payload.file);
  });
}

export async function configureRuntimeApiBase() {
  if (!isDesktopRuntime()) return;
  API_BASE = (await invokeDesktop<string>("backend_endpoint")).replace(/\/$/, "");
}
