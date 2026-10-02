import type { AppUpdate } from "@/lib/types";

export type UpdateCheckTone = "muted" | "success" | "available" | "error";

/** Ce que la fenêtre « À propos » dit de la dernière recherche de mise à jour. */
export function updateCheckStatus(
  update: AppUpdate | null,
  { checking, failure }: { checking: boolean; failure: string },
): { tone: UpdateCheckTone; text: string } {
  if (checking) return { tone: "muted", text: "Recherche d'une nouvelle version…" };
  if (failure) return { tone: "error", text: failure };
  if (!update) return { tone: "muted", text: "Aucune recherche pour l'instant." };
  if (!update.checked) return { tone: "error", text: update.error || "Vérification impossible pour le moment." };
  if (update.update_available) return { tone: "available", text: `La version ${update.latest} est disponible.` };
  return { tone: "success", text: "Tu as la dernière version." };
}

/** « aujourd'hui à 14:32 », ou « le 03/10 à 14:32 » pour un autre jour ; vide sans vérification. */
export function formatCheckedAt(seconds: number | undefined, now = new Date()) {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `aujourd'hui à ${time}`;
  return `le ${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} à ${time}`;
}
