"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import {
  type RepositoryCheckEntry,
  repositoriesToCheck,
  repositoryCheckKey,
  type RepositoryUpdateCheck,
} from "@/lib/module-repositories";
import type { ModuleRepository } from "@/lib/types";

// Contrôles gardés pour toute la session : changer de vue, d'onglet ou de projet ne relit pas GitLab
// avant quelques minutes. Chaque changement remplace la table, pour que React voie la nouvelle version.
let entries: ReadonlyMap<string, RepositoryCheckEntry> = new Map();
const listeners = new Set<() => void>();

function store(changes: [string, RepositoryCheckEntry][]) {
  const next = new Map(entries);
  for (const [key, entry] of changes) next.set(key, entry);
  entries = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: ReadonlyMap<string, RepositoryCheckEntry> = new Map();

// Juste après un changement de projet, la liste affichée est encore celle de l'ancien projet le temps
// que son chargement commence : le contrôle attend un instant que la liste soit la bonne.
const CHECK_DELAY_MS = 500;

/**
 * Résultat lu par le sélecteur de branche : l'en-tête du dépôt suit ce que le sélecteur vient d'afficher.
 * Rangé sous la branche et le commit lus sur le disque : l'en-tête le retrouve dès que la liste les montre.
 */
export function recordRepositoryCheck(project: string, repositoryId: string, check: RepositoryUpdateCheck) {
  const key = repositoryCheckKey(project, { id: repositoryId, branch: check.branch, commit: check.commit });
  store([[key, { at: Date.now(), check }]]);
}

/**
 * Compare au serveur, en une seule requête, les dépôts modifiables du projet qui n'ont pas de contrôle
 * récent. Jamais bloquant et silencieux : sans réseau ou sans GitLab, rien n'est signalé, et l'ouverture
 * du sélecteur de branche dira ce qui bloque.
 */
export function useRepositoryUpdateChecks(
  project: string | undefined,
  repositories: ModuleRepository[],
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !project) return;
    const timer = window.setTimeout(() => {
      const pending = repositoriesToCheck(project, repositories, entries, Date.now());
      if (!pending.length) return;
      const keys = pending.map((repository) => repositoryCheckKey(project, repository));
      // Marqués en cours aussitôt (en gardant le dernier résultat) : un nouveau rendu ne relance pas la lecture.
      const keep = (at: number) =>
        keys.map((key): [string, RepositoryCheckEntry] => [key, { at, check: entries.get(key)?.check ?? null }]);
      store(keep(Date.now()));
      api<{ repositories?: Record<string, RepositoryUpdateCheck> }>(
        `/api/projects/${encodeURIComponent(project)}/repository/updates`,
        { method: "POST", body: JSON.stringify({ repositories: pending.map((repository) => repository.id) }) },
      )
        .then((result) => {
          const at = Date.now();
          store(
            pending.map((repository, index) => [
              keys[index],
              { at, check: result.repositories?.[repository.id] ?? entries.get(keys[index])?.check ?? null },
            ]),
          );
        })
        .catch(() => store(keep(Date.now())));
    }, CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, project, repositories]);
}

/** Dernier contrôle connu du dépôt tel qu'il est chargé, ou null. */
export function useRepositoryCheck(project: string, repository: Pick<ModuleRepository, "id" | "branch" | "commit">) {
  const current = useSyncExternalStore(
    subscribe,
    () => entries,
    () => EMPTY,
  );
  return current.get(repositoryCheckKey(project, repository))?.check ?? null;
}
