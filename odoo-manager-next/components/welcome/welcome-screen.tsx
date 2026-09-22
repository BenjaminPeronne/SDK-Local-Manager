"use client";

import { AlertTriangle, CheckCircle2, FolderPlus, RefreshCcw, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Accueil affiché quand aucun projet n'est ouvert.
 *
 * Sans projet, les onglets ne montrent que des panneaux vides : l'écran dit plutôt ce que
 * l'application attend, et si ses deux dépendances sont prêtes.
 */
export function WelcomeScreen({
  icon,
  hasProjects,
  docker,
  traefik,
  onCreateProject,
  onOpenSettings,
  onRefresh,
}: {
  icon: { src: string };
  hasProjects: boolean;
  docker: { ready: boolean; message: string };
  traefik: { ready: boolean; message: string } | null;
  onCreateProject: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col items-center px-4 py-12 text-center sm:py-16">
      <img src={icon.src} alt="" aria-hidden="true" className="h-16 w-16 rounded-2xl object-cover shadow-sm sm:h-[72px] sm:w-[72px]" />
      <h2 className="mt-5 text-2xl font-semibold sm:text-3xl">SDK Local Manager</h2>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
        {hasProjects
          ? "Sélectionne un projet dans la barre de gauche pour ouvrir ses bases, ses modules et son activité."
          : "Aucun projet pour l’instant. Crée ton premier environnement Odoo local : le gestionnaire prépare le code, la base et l’accès web."}
      </p>

      <div className="mt-8 grid w-full max-w-xl gap-3 sm:grid-cols-2">
        <WelcomeStatus title="Docker" ready={docker.ready} message={docker.message} />
        <WelcomeStatus
          title="Traefik"
          ready={Boolean(traefik?.ready)}
          message={traefik?.message || "Vérification en cours…"}
        />
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
        <p className="mt-6 text-xs text-muted-foreground">
          Échap ramène à cet écran depuis un projet éteint.
        </p>
      )}
    </div>
  );
}

function WelcomeStatus({ title, ready, message }: { title: string; ready: boolean; message: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left">
      {ready ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          {title}
          <Badge variant={ready ? "success" : "outline"}>{ready ? "Prêt" : "À vérifier"}</Badge>
        </div>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
