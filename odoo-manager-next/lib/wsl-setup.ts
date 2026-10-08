// Préparation du poste Windows : ce qu'il reste à faire, et dans quel ordre.
//
// Les projets servis depuis C:\ traversent le pont 9P de Docker Desktop : Odoo met
// 48 à 95 s à démarrer contre 4 à 6 s dans l'environnement Linux. L'utilisateur ne
// voit qu'un bouton ; cette logique dit lequel afficher.

import type { WslPrepareStep } from "./desktop";

export interface WslStatus {
  /** Absent sous Windows ; faux quand le système ne connaît pas d'environnement Linux. */
  supported?: boolean;
  wslInstalled: boolean;
  wslVersion: string;
  supportsFileImport: boolean;
  distribution: string;
  distributionInstalled: boolean;
  release: string;
  /** Lue avant l'installation de l'environnement ; `unknown` quand Windows ne répond pas nettement. */
  virtualization?: "enabled" | "disabled" | "unknown";
  /** Mémoire de l'ordinateur, en octets. */
  memory?: { total: number; free: number };
  /** Vrai quand une préparation tourne déjà, lancée au démarrage de l'application. */
  preparing?: boolean;
  progress?: WslPrepareStep | null;
}

const GIB = 1024 ** 3;

/**
 * Avertissement sur la mémoire avant l'installation, ou une chaîne vide.
 *
 * Linux reçoit au plus la moitié de la mémoire de l'ordinateur : sous 8 Go, les projets Odoo
 * y sont à l'étroit. Rien n'est bloqué, l'utilisateur est prévenu avant les minutes d'attente.
 */
export function memoryWarning(status: WslStatus | null): string {
  if (!status?.memory || status.distributionInstalled) return "";
  const gigabytes = (bytes: number) => Math.round((bytes / GIB) * 10) / 10;
  if (status.memory.total < 8 * GIB) {
    return `Cet ordinateur a peu de mémoire (${gigabytes(status.memory.total)} Go) : l'environnement fonctionnera, mais les projets pourront être lents. Ferme les autres applications pendant la préparation.`;
  }
  if (status.memory.free < 2 * GIB) {
    return `Il reste peu de mémoire libre (${gigabytes(status.memory.free)} Go) : ferme les autres applications avant de commencer.`;
  }
  return "";
}

export type WslSetupStep =
  | "unsupported"
  | "virtualization-disabled"
  | "install-wsl"
  | "outdated-wsl"
  | "install-environment"
  | "update-environment"
  | "ready";

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
  // Bloquant avant tout le reste : sans virtualisation, l'environnement ne démarrera jamais, et
  // seul l'utilisateur peut l'activer. Dit dès l'ouverture, au lieu d'après plusieurs minutes.
  if (!status.distributionInstalled && status.virtualization === "disabled") {
    return {
      step: "virtualization-disabled",
      title: "Activer la virtualisation",
      detail:
        "La virtualisation est désactivée sur cet ordinateur : l'environnement Linux ne peut pas démarrer sans elle. " +
        "Elle s'active dans le BIOS, au démarrage de l'ordinateur (option « Intel VT-x », « AMD-V » ou « SVM »). " +
        "Redémarre ensuite, et l'application reprendra ici.",
      actionLabel: "Vérifier à nouveau",
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
  if (/0x80370102|HCS_E_HYPERV_NOT_INSTALLED|virtuali[sz]ation/i.test(message)) {
    return "La virtualisation est désactivée dans le BIOS de ce poste. Active-la, puis réessaie.";
  }
  // L'application a déjà redémarré l'environnement Linux et réessayé : il reste le redémarrage
  // de l'ordinateur, que l'utilisateur fait seul. La cause technique est dans le journal.
  const retryAdvice =
    "Redémarre l'ordinateur, puis clique à nouveau sur « Préparer mon poste ». " +
    "Si cela se reproduit, ouvre le journal et envoie-le au support.";
  if (/après plusieurs essais/i.test(message)) return `${message} ${retryAdvice}`;
  if (/délai imparti|sans message|interrompu|^Command failed/i.test(message)) {
    return `La préparation s'est arrêtée malgré plusieurs essais. ${retryAdvice}`;
  }
  // Erreur système brute (EACCES, EPERM…) : jamais affichée telle quelle.
  if (/^(E[A-Z]{2,}\b|Error\b)/.test(message)) return `La préparation a échoué. ${retryAdvice}`;
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
