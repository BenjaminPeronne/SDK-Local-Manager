"use client";

import { useCallback, useEffect, useState } from "react";
import { desktopBridge, desktopErrorMessage, type UpdateSupport } from "@/lib/desktop";
import type { AppUpdate } from "@/lib/types";

export type UpdatePhase =
  | { name: "idle" }
  | { name: "downloading"; percent: number }
  | { name: "ready"; mode: "restart" | "installer"; hint: string }
  | { name: "restarting" }
  | { name: "opened"; hint: string }
  | { name: "failed"; message: string; tag: string };

const IDLE: UpdatePhase = { name: "idle" };

/**
 * Téléchargement et installation de la version annoncée. Un seul exemplaire, tenu par la page :
 * l'annonce de la barre latérale et la fenêtre « À propos » montrent le même avancement.
 */
export function useUpdateInstaller(update: AppUpdate | null) {
  const [support, setSupport] = useState<UpdateSupport | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>(IDLE);
  const tag = update?.update_available ? update.tag : "";

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.updateSupport) return;
    let cancelled = false;
    bridge
      .updateSupport()
      .then((value) => {
        if (!cancelled) setSupport(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const download = useCallback(async () => {
    const bridge = desktopBridge();
    if (!bridge?.downloadUpdate || !tag) return;
    setPhase({ name: "downloading", percent: 0 });
    const unsubscribe = bridge.onUpdateProgress?.((progress) => {
      const percent = progress.total > 0 ? Math.min(100, Math.floor((progress.received * 100) / progress.total)) : 0;
      // Un avancement arrivé après la fin du téléchargement ne doit pas le faire reprendre.
      setPhase((current) => (current.name === "downloading" ? { name: "downloading", percent } : current));
    });
    try {
      const result = await bridge.downloadUpdate(tag);
      setPhase(
        result.mode === "none"
          ? { name: "failed", message: "La mise à jour automatique n'est pas possible pour cette installation.", tag }
          : { name: "ready", mode: result.mode, hint: result.hint },
      );
    } catch (error) {
      setPhase({ name: "failed", message: desktopErrorMessage(error, "Le téléchargement a échoué."), tag });
    } finally {
      unsubscribe?.();
    }
  }, [tag]);

  const install = useCallback(async () => {
    const bridge = desktopBridge();
    if (!bridge?.installUpdate || phase.name !== "ready") return;
    const { mode, hint } = phase;
    if (mode === "restart") setPhase({ name: "restarting" });
    try {
      await bridge.installUpdate();
      // En mode redémarrage, l'application se ferme avant d'arriver ici.
      if (mode === "installer") setPhase({ name: "opened", hint });
    } catch (error) {
      setPhase({ name: "failed", message: desktopErrorMessage(error, "L'installation n'a pas pu démarrer."), tag });
    }
  }, [phase, tag]);

  // L'échec d'une version déjà dépassée ne concerne plus celle qui vient d'être annoncée.
  let current = phase.name === "failed" && phase.tag !== tag ? IDLE : phase;
  // Installation tentée avant ce démarrage, restée sans effet : l'annonce le dit au lieu de reproposer en silence.
  if (current.name === "idle" && tag && support?.failure) current = { name: "failed", message: support.failure, tag };
  return {
    automatic: Boolean(tag) && support !== null && support.mode !== "none",
    busy: current.name === "downloading" || current.name === "ready" || current.name === "restarting",
    phase: current,
    download,
    install,
  };
}

export type UpdateInstaller = ReturnType<typeof useUpdateInstaller>;
