// Préparation du poste Windows : ce qu'il reste à faire, et dans quel ordre.
//
// Les projets servis depuis C:\ traversent le pont 9P de Docker Desktop : Odoo met
// 48 à 95 s à démarrer contre 4 à 6 s dans l'environnement Linux. L'utilisateur ne
// voit qu'un bouton ; cette logique dit lequel afficher.

export interface WslStatus {
  /** Absent sous Windows ; faux quand le système ne connaît pas d'environnement Linux. */
  supported?: boolean;
  wslInstalled: boolean;
  wslVersion: string;
  supportsFileImport: boolean;
  distribution: string;
  distributionInstalled: boolean;
  release: string;
}

export type WslSetupStep =
  "unsupported" | "install-wsl" | "outdated-wsl" | "install-environment" | "update-environment" | "ready";

export interface WslSetupState {
  step: WslSetupStep;
  title: string;
  detail: string;
  actionLabel: string;
  /** Vrai quand l'action demande les droits administrateur une seule fois. */
  needsElevation: boolean;
}

const READY: WslSetupState = {
  step: "ready",
  title: "Environnement Linux prêt",
  detail: "Les projets tournent sur un système de fichiers Linux : Odoo démarre en quelques secondes.",
  actionLabel: "",
  needsElevation: false,
};

export function wslSetupState(status: WslStatus | null, applicationVersion: string): WslSetupState {
  // Hors Windows, il n'y a rien à préparer : un statut absent, ou qui se déclare non pris en
  // charge, ne doit jamais être lu comme un WSL qu'il resterait à installer.
  if (!status || status.supported === false) {
    return {
      step: "unsupported",
      title: "Environnement Linux indisponible",
      detail: "Cette version de l'application ne gère pas l'environnement Linux sur ce système.",
      actionLabel: "",
      needsElevation: false,
    };
  }
  if (!status.wslInstalled) {
    return {
      step: "install-wsl",
      // WSL est nommé une fois, entre parenthèses : c'est le nom que montre la demande d'autorisation de Windows.
      title: "Activer Linux dans Windows",
      detail:
        "Windows doit activer sa fonction Linux (WSL). Une autorisation est demandée, puis un redémarrage peut être nécessaire.",
      actionLabel: "Activer",
      needsElevation: true,
    };
  }
  if (!status.supportsFileImport) {
    return {
      step: "outdated-wsl",
      title: "Mettre à jour Linux dans Windows",
      detail: `La fonction Linux de Windows (WSL ${status.wslVersion}) est trop ancienne pour installer l'environnement. Mets-la à jour, puis reviens ici.`,
      actionLabel: "Mettre à jour",
      needsElevation: true,
    };
  }
  if (!status.distributionInstalled) {
    return {
      step: "install-environment",
      title: "Préparer mon poste",
      detail:
        "L'application installe son environnement Linux, avec Docker et Git. Aucune autre action ne sera demandée.",
      actionLabel: "Préparer mon poste",
      needsElevation: false,
    };
  }
  if (status.release !== applicationVersion) {
    return {
      step: "update-environment",
      title: "Mettre à jour l'environnement",
      detail: `L'environnement est en version ${status.release || "inconnue"}, l'application en ${applicationVersion}. Les projets et les bases ne sont pas touchés.`,
      actionLabel: "Mettre à jour",
      needsElevation: false,
    };
  }
  return READY;
}

export function isWslSetupPending(status: WslStatus | null, applicationVersion: string): boolean {
  const { step } = wslSetupState(status, applicationVersion);
  return step !== "ready" && step !== "unsupported";
}

/** Message lisible pour un échec de préparation, sans jargon. */
export function wslSetupError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error ?? "")).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
  if (/empreinte/i.test(message)) {
    return "L'image de l'environnement ne correspond pas à son empreinte. Retélécharge l'application.";
  }
  if (/ENOENT|introuvable|no such file/i.test(message)) {
    return "L'image de l'environnement est absente de cette installation. Retélécharge l'application complète.";
  }
  if (/0x80370102|virtualis/i.test(message)) {
    return "La virtualisation est désactivée dans le BIOS de ce poste. Active-la, puis réessaie.";
  }
  if (/délai imparti/i.test(message)) {
    return "La préparation a pris trop de temps. Redémarre l'ordinateur, puis réessaie.";
  }
  // Arrêt sans explication : la commande elle-même n'aide pas l'utilisateur, le journal la garde.
  if (/sans message|interrompu|^Command failed/i.test(message)) {
    return (
      "La préparation s'est arrêtée sans explication. Réessaie ; si cela se reproduit, " +
      "envoie le journal du gestionnaire (fichier backend.log) au support."
    );
  }
  return message || "La préparation a échoué.";
}

// Durée habituelle de chaque étape de la préparation, en secondes. Aucune ne publie son
// avancement : ces durées donnent à chacune sa part de la barre et la vitesse à laquelle la
// barre avance pendant qu'elle tourne.
const PREPARE_STEP_SECONDS = { import: 180, backend: 20, provision: 120 } as const;
type PrepareStepName = keyof typeof PREPARE_STEP_SECONDS;
const PREPARE_STEP_ORDER: PrepareStepName[] = ["import", "backend", "provision"];

/**
 * Avancement global de la préparation, de 0 à 100 : une seule barre qui ne recule pas.
 *
 * Pendant une étape, la barre approche de sa fin sans l'atteindre : aux deux tiers à la durée
 * habituelle, puis de plus en plus lentement si l'étape dure davantage.
 */
export function prepareProgressPercent(
  progress: { step: string; index: number; total: number } | null,
  stepElapsedSeconds: number,
): number {
  if (!progress) return 0;
  if (progress.step === "done") return 100;
  // Seule une première installation passe par les trois étapes ; une mise à jour saute l'import.
  const planned =
    progress.total >= PREPARE_STEP_ORDER.length
      ? PREPARE_STEP_ORDER
      : PREPARE_STEP_ORDER.slice(PREPARE_STEP_ORDER.length - progress.total);
  const current = progress.step as PrepareStepName;
  const position = planned.indexOf(current);
  if (position < 0) return 0;
  const total = planned.reduce((sum, step) => sum + PREPARE_STEP_SECONDS[step], 0);
  const done = planned.slice(0, position).reduce((sum, step) => sum + PREPARE_STEP_SECONDS[step], 0);
  const expected = PREPARE_STEP_SECONDS[current];
  const elapsed = Math.max(0, stepElapsedSeconds);
  const running = expected * (elapsed / (elapsed + expected / 2));
  return Math.min(99, Math.floor(((done + running) / total) * 100));
}
