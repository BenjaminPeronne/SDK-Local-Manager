"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderPlus,
  Hourglass,
  Loader2,
  Mail,
  RefreshCcw,
  Settings,
} from "lucide-react";
import { newYearGreeting, type Season } from "@/lib/seasonal";
import type { DockerSummary } from "@/lib/system-notices";
import type { MailpitStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChristmasHat, Snowfall } from "@/components/seasonal/christmas";
import { BunnyEars, EasterEggs } from "@/components/seasonal/easter";
import { Bats, WitchHat } from "@/components/seasonal/halloween";
import { cn } from "@/lib/utils";

/**
 * Accueil affiché quand aucun projet n'est ouvert.
 *
 * Sans projet, les onglets ne montrent que des panneaux vides : l'écran dit plutôt ce que
 * l'application attend, si ses deux dépendances sont prêtes, et si les e-mails sont capturés.
 * Chaque carte porte l'action qui la débloque : l'accueil n'affiche pas en plus les bandeaux
 * Docker et Traefik, qui répétaient la même chose.
 */
export function WelcomeScreen({
  icon,
  season,
  hasProjects,
  docker,
  traefik,
  mailpit,
  onStartMailpit,
  onOpenMailpit,
  onCreateProject,
  onOpenSettings,
  onRefresh,
}: {
  icon: { src: string };
  season: Season | null;
  hasProjects: boolean;
  docker: { state: DockerSummary["state"]; message: string; detail: string; action?: ReactNode };
  /** `waiting` : Docker arrêté, Traefik ne peut que l'attendre. */
  traefik: { ready: boolean; waiting: boolean; message: string; action?: ReactNode } | null;
  mailpit: MailpitStatus | undefined;
  onStartMailpit: () => void;
  onOpenMailpit: () => void;
  onCreateProject: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="relative isolate mx-auto flex max-w-[1500px] flex-col items-center px-4 py-12 text-center sm:py-16">
      {season === "christmas" && <Snowfall />}
      {season === "easter" && <EasterEggs />}
      {season === "halloween" && <Bats />}
      <span className="relative">
        <img
          src={icon.src}
          alt=""
          aria-hidden="true"
          className="h-16 w-16 rounded-2xl object-cover shadow-sm sm:h-[72px] sm:w-[72px]"
        />
        {season === "christmas" && <ChristmasHat />}
        {season === "easter" && <BunnyEars />}
        {season === "halloween" && <WitchHat />}
      </span>
      <h2 className="mt-5 text-2xl font-semibold sm:text-3xl">SDK Local Manager</h2>
      {season === "christmas" && (
        <p className="mt-1 text-sm font-medium text-red-700 dark:text-red-400">Joyeux Noël et belles fêtes ! 🎄</p>
      )}
      {season === "easter" && (
        <p className="mt-1 text-sm font-medium text-pink-700 dark:text-pink-400">Joyeuses Pâques ! 🐣</p>
      )}
      {season === "halloween" && (
        <p className="mt-1 text-sm font-medium text-orange-700 dark:text-orange-400">Joyeux Halloween ! 🎃</p>
      )}
      {season === "new-year" && (
        <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-400">{newYearGreeting(new Date())}</p>
      )}
      <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
        {hasProjects
          ? "Sélectionne un projet dans la barre de gauche pour ouvrir ses bases, ses modules et son activité."
          : "Aucun projet pour l’instant. Crée ton premier environnement Odoo local : le gestionnaire prépare le code, la base et l’accès web."}
      </p>

      <div className="mt-8 grid w-full max-w-xl gap-3 sm:grid-cols-2">
        <WelcomeStatus
          title="Docker"
          ready={docker.state === "ready"}
          busy={docker.state === "starting" || docker.state === "checking"}
          pendingLabel={DOCKER_LABELS[docker.state]}
          message={docker.message}
          detail={docker.detail}
          action={docker.action}
          actionBelow
        />
        <WelcomeStatus
          title="Traefik"
          ready={Boolean(traefik?.ready)}
          busy={!traefik}
          waiting={traefik?.waiting}
          pendingLabel={traefik?.waiting ? "En attente" : traefik ? "À vérifier" : "Vérification"}
          message={traefik?.message || "Vérification en cours…"}
          action={traefik?.action}
          actionBelow
        />
        {mailpit && (
          <WelcomeStatus
            className="sm:col-span-2"
            title="Mailpit"
            ready={mailpit.running}
            optional
            readyLabel="Démarré"
            pendingLabel="Facultatif"
            message={mailpit.message}
            action={
              mailpit.running ? (
                <Button size="sm" variant="outline" onClick={onOpenMailpit}>
                  <ExternalLink className="h-4 w-4" />
                  Voir les e-mails
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled={!mailpit.can_start} onClick={onStartMailpit}>
                  <Mail className="h-4 w-4" />
                  {mailpit.installed ? "Démarrer" : "Installer"}
                </Button>
              )
            }
          />
        )}
      </div>

      <div className="mt-8 flex w-full max-w-xl flex-col gap-2 sm:flex-row sm:justify-center">
        <Button className="w-full sm:w-auto" onClick={onCreateProject}>
          <FolderPlus className="h-4 w-4" />
          Nouveau projet
        </Button>
        <Button className="w-full sm:w-auto" variant="outline" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
          Paramètres
        </Button>
        <Button className="w-full sm:w-auto" variant="ghost" onClick={onRefresh}>
          <RefreshCcw className="h-4 w-4" />
          Actualiser
        </Button>
      </div>

      {hasProjects && (
        <p className="mt-6 text-xs text-muted-foreground">Échap ramène à cet écran depuis un projet éteint.</p>
      )}
    </div>
  );
}

const DOCKER_LABELS: Record<DockerSummary["state"], string> = {
  checking: "Vérification",
  ready: "Prêt",
  starting: "Démarrage",
  stopped: "Arrêté",
  missing: "À installer",
};

function WelcomeStatus({
  title,
  ready,
  message,
  detail,
  readyLabel = "Prêt",
  pendingLabel = "À vérifier",
  action,
  className,
  optional = false,
  busy = false,
  waiting = false,
  actionBelow = false,
}: {
  title: string;
  ready: boolean;
  message: string;
  /** Message technique, en infobulle seulement. */
  detail?: string;
  readyLabel?: string;
  pendingLabel?: string;
  action?: ReactNode;
  className?: string;
  // Un outil facultatif arrêté n'est pas un problème : pas d'alerte orange.
  optional?: boolean;
  /** Vérification ou démarrage en cours. */
  busy?: boolean;
  /** Dépend d'un autre outil encore arrêté : rien à faire de son côté. */
  waiting?: boolean;
  /** Carte étroite : le bouton passe sous le texte au lieu de l'écraser. */
  actionBelow?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left", className)}>
      {ready ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : busy ? (
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
      ) : waiting ? (
        <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      ) : optional ? (
        <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      ) : (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          {title}
          <Badge variant={ready ? "success" : "outline"}>{ready ? readyLabel : pendingLabel}</Badge>
        </div>
        <p className="mt-0.5 break-words text-xs text-muted-foreground" title={detail || undefined}>
          {message}
        </p>
        {action && actionBelow && <div className="mt-2">{action}</div>}
      </div>
      {action && !actionBelow && <div className="ml-auto shrink-0 self-center">{action}</div>}
    </div>
  );
}
