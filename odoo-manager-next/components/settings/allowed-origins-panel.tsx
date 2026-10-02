"use client";

import { useState } from "react";
import { Globe, Plus, X } from "lucide-react";
import { LOCAL_INTERFACE_URL } from "@/lib/api";
import type { ManagerSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "@/components/settings/settings-section";

/** Même règle que le service : adresse exacte http(s), sans chemin ni joker. */
function normalizeOrigin(value: string) {
  const origin = value.trim().replace(/\/+$/, "").toLowerCase();
  return /^https?:\/\/[^/\s?#@*]+$/.test(origin) ? origin : "";
}

/** Autres adresses d'où l'interface ouverte dans un navigateur peut lancer des actions. */
export function AllowedOriginsPanel({
  settingsDraft,
  setSettingsDraft,
}: {
  settingsDraft: ManagerSettings;
  setSettingsDraft: (settings: ManagerSettings) => void;
}) {
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState("");
  const origins = settingsDraft.allowed_origins ?? [];
  const active = settingsDraft.active_browser_origins ?? [];
  const currentOrigin = typeof window === "undefined" ? "" : window.location.origin.toLowerCase();
  // Le service refuse l'enregistrement venu d'une adresse qu'il ne connaît pas encore.
  const currentRefused = currentOrigin.startsWith("http") && active.length > 0 && !active.includes(currentOrigin);

  function addOrigin() {
    const origin = normalizeOrigin(entry);
    if (!origin) {
      setEntryError(
        "Adresse non reconnue. Écris-la comme dans la barre d’adresse, par exemple http://rika.localhost, sans chemin ni *.",
      );
      return;
    }
    setEntry("");
    setEntryError("");
    if (!origins.includes(origin)) setSettingsDraft({ ...settingsDraft, allowed_origins: [...origins, origin] });
  }

  return (
    <SettingsGroup>
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4" />
          Adresses de l’interface dans le navigateur
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Si tu ouvres le gestionnaire par une autre adresse que {LOCAL_INTERFACE_URL}, par exemple une route Traefik
          comme http://rika.localhost, ajoute-la ici. Sinon, ses actions sont refusées. N’ajoute jamais l’adresse d’un
          projet Odoo.
        </p>
      </div>

      {currentRefused && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
          Cette page est ouverte sur <code>{currentOrigin}</code>, qui n’est pas encore autorisée : l’enregistrement
          sera refusé d’ici. Ouvre{" "}
          <a className="underline" href={LOCAL_INTERFACE_URL}>
            {LOCAL_INTERFACE_URL}
          </a>{" "}
          pour l’ajouter.
        </p>
      )}

      {origins.length > 0 && (
        <ul className="grid gap-1.5">
          {origins.map((origin) => (
            <li key={origin} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
              <code className="break-all">{origin}</code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={`Retirer ${origin}`}
                onClick={() =>
                  setSettingsDraft({ ...settingsDraft, allowed_origins: origins.filter((item) => item !== origin) })
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-1.5">
        <div className="flex gap-2">
          <Input
            value={entry}
            placeholder="http://rika.localhost"
            onChange={(event) => {
              setEntry(event.target.value);
              setEntryError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addOrigin();
              }
            }}
          />
          <Button variant="outline" onClick={addOrigin} disabled={!entry.trim()}>
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        </div>
        {entryError && <span className="text-xs text-destructive">{entryError}</span>}
      </div>
    </SettingsGroup>
  );
}
