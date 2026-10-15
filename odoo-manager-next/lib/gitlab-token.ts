import type { GitLabStatus } from "./desktop";

/** Page de création d'un jeton sur GitLab, nom et droit en lecture seule déjà remplis. */
export const GITLAB_TOKEN_URL =
  "https://gitlab.sudokeys.com/-/user_settings/personal_access_tokens?name=SDK%20Local%20Manager&scopes=read_api";

/** L'application prévient une semaine avant l'expiration du jeton, comme le courriel de GitLab. */
export const GITLAB_TOKEN_WARNING_DAYS = 7;

export type GitLabTokenNotice = {
  /** Jeton déjà inutilisable (expiré, révoqué) plutôt que bientôt expiré. */
  expired: boolean;
  text: string;
};

/** « 22 octobre 2026 », pour une date AAAA-MM-JJ de GitLab. */
export function gitlabTokenDate(expiresAt: string) {
  return new Date(`${expiresAt}T00:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Message à afficher sur le jeton GitLab : expiré, ou expirant dans la semaine ; null sinon. */
export function gitlabTokenNotice(status: GitLabStatus | null | undefined): GitLabTokenNotice | null {
  if (!status) return null;
  const daysLeft = status.daysLeft ?? null;
  if (status.expired) {
    return {
      expired: true,
      text:
        status.expiresAt && daysLeft !== null && daysLeft <= 0
          ? `Ton jeton GitLab a expiré le ${gitlabTokenDate(status.expiresAt)}.`
          : "Ton jeton GitLab a expiré ou a été révoqué.",
    };
  }
  if (status.connected && status.expiresAt && daysLeft !== null && daysLeft <= GITLAB_TOKEN_WARNING_DAYS) {
    const when = daysLeft === 1 ? "demain" : `dans ${daysLeft} jours`;
    return { expired: false, text: `Ton jeton GitLab expire ${when}, le ${gitlabTokenDate(status.expiresAt)}.` };
  }
  return null;
}
