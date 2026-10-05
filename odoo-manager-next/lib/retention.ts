import type { Project } from "./types";

/** Les bases sont signalées une semaine avant leur suppression automatique, puis la veille. */
export const RETENTION_WARNING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionTone = "muted" | "warning" | "danger";

export type UpcomingDeletion = {
  project: string;
  db: string;
  expiresAt: number;
  days: number;
};

/** Jours de calendrier avant la suppression : 0 aujourd'hui (ou déjà passée), 1 demain. */
export function daysUntil(expiresAt: number, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(expiresAt * 1000);
  const day = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.max(0, Math.round((day - today) / DAY_MS));
}

export function deletionDate(expiresAt: number) {
  return new Date(expiresAt * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

/** Ce que la carte d'une base affiche, et sa couleur. */
export function deletionLabel(expiresAt: number, now = new Date()): { text: string; tone: RetentionTone } {
  if (expiresAt * 1000 <= now.getTime()) return { text: "Supprimée dès que possible", tone: "danger" };
  const days = daysUntil(expiresAt, now);
  if (days === 0) return { text: "Supprimée aujourd’hui", tone: "danger" };
  if (days === 1) return { text: "Supprimée demain", tone: "danger" };
  if (days <= RETENTION_WARNING_DAYS) return { text: `Supprimée dans ${days} jours`, tone: "warning" };
  return { text: `Supprimée le ${deletionDate(expiresAt)}`, tone: "muted" };
}

/** Bases de tous les projets supprimées dans la semaine, la plus proche d'abord. */
export function upcomingDeletions(projects: Project[], now = new Date()): UpcomingDeletion[] {
  const upcoming: UpcomingDeletion[] = [];
  for (const project of projects) {
    for (const [db, retention] of Object.entries(project.database_retention ?? {})) {
      if (retention.expires_at === null || retention.expires_at === undefined) continue;
      const days = daysUntil(retention.expires_at, now);
      if (days <= RETENTION_WARNING_DAYS)
        upcoming.push({ project: project.name, db, expiresAt: retention.expires_at, days });
    }
  }
  return upcoming.sort((first, second) => first.expiresAt - second.expiresAt);
}

/**
 * Palier de notification atteint : `7` dans la semaine, `1` la veille ou le jour même.
 * Chaque palier ne notifie qu'une fois par échéance : repousser l'échéance en ouvre de nouveaux.
 */
export function notificationKey(deletion: UpcomingDeletion) {
  const step = deletion.days <= 1 ? 1 : 7;
  return `retention-notified:${deletion.project}/${deletion.db}/${deletion.expiresAt}/${step}`;
}
