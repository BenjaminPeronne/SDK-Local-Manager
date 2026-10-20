import type { DockerStatus, TraefikStatus } from "./types";

/** Après « Ouvrir Docker », temps laissé à Docker Desktop (20 à 60 s d'habitude) avant de reparler d'arrêt. */
export const DOCKER_START_WAIT_MS = 120_000;

export type DockerSummary = {
  state: "checking" | "ready" | "starting" | "missing" | "stopped";
  title: string;
  message: string;
  /** Message brut de Docker, en anglais : gardé pour l'infobulle, utile au support seulement. */
  detail: string;
};

/**
 * État de Docker dit simplement. Arrêté, Docker renvoie un message technique en anglais
 * (« Cannot connect to the Docker daemon at unix://… ») : il ne dit rien de ce qu'il faut faire.
 */
export function dockerSummary(docker: DockerStatus | undefined, starting: boolean): DockerSummary {
  if (!docker) return { state: "checking", title: "Docker", message: "Vérification en cours…", detail: "" };
  if (docker.running) return { state: "ready", title: "Docker est prêt", message: docker.message, detail: "" };
  if (docker.state === "missing")
    return { state: "missing", title: "Docker n’est pas installé", message: docker.message, detail: "" };
  if (starting)
    return {
      state: "starting",
      title: "Docker démarre…",
      message: "Tes projets pourront démarrer dans quelques instants.",
      detail: "",
    };
  return {
    state: "stopped",
    title: "Docker est arrêté",
    message: "Tes projets ne peuvent pas démarrer tant que Docker est arrêté.",
    detail: docker.message,
  };
}

/** Traefik tourne dans Docker : tant que Docker est arrêté, une alerte Traefik ne dirait rien de plus. */
export function traefikNeedsAttention(traefik: TraefikStatus | undefined, dockerRunning: boolean) {
  return Boolean(traefik && !traefik.running && dockerRunning);
}
