"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, LogIn, LogOut, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { RemoteBackup, RemoteBackupsState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatBackupDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

/** Choix d'une sauvegarde d'un client Sudokeys, après connexion avec le compte sudokeys.com. */
export function RemoteBackupPicker({
  selected,
  disabled,
  onSelect,
}: {
  selected: RemoteBackup | null;
  disabled: boolean;
  onSelect: (backup: RemoteBackup | null) => void;
}) {
  const [state, setState] = useState<RemoteBackupsState | null>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<RemoteBackupsState>("/api/remote-backups")
      .then((result) => {
        if (cancelled) return;
        setState(result);
        setLogin((current) => current || result.login);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Lecture impossible."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function connect(withPassword: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await api<RemoteBackupsState>("/api/remote-backups", {
        method: "POST",
        body: JSON.stringify(withPassword ? { login: login.trim(), password } : {}),
      });
      setState(result);
      setPassword("");
      if (selected && !result.backups.some((backup) => backup.id === selected.id)) onSelect(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      setState(await api<RemoteBackupsState>("/api/remote-backups", { method: "DELETE" }));
      onSelect(null);
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = new Map<string, RemoteBackup[]>();
    for (const backup of state?.backups || []) {
      const haystack = `${backup.project} ${backup.branch} ${backup.database}`.toLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      result.set(backup.project, [...(result.get(backup.project) || []), backup]);
    }
    return Array.from(result.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [query, state?.backups]);

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {error || (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </>
        )}
      </div>
    );
  }

  if (!state.connected) {
    return (
      <form
        className="grid gap-3 rounded-md border bg-muted/35 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void connect(true);
        }}
      >
        <p className="text-sm text-muted-foreground">
          Connecte-toi avec ton compte sudokeys.com pour voir les sauvegardes des clients auxquels tu as accès. Le mot
          de passe est oublié à la fermeture de l’application.
        </p>
        <label className="grid gap-1.5 text-sm font-medium">
          Identifiant sudokeys.com
          <Input
            value={login}
            autoComplete="username"
            disabled={busy || disabled}
            onChange={(event) => setLogin(event.target.value)}
            placeholder="prenom.nom@sudokeys.com"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Mot de passe ou clé API
          <Input
            type="password"
            value={password}
            autoComplete="current-password"
            disabled={busy || disabled}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="outline" disabled={busy || disabled || !login.trim() || !password}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {busy ? "Recherche des sauvegardes…" : "Se connecter"}
        </Button>
      </form>
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Client, branche ou base"
            aria-label="Filtrer les sauvegardes"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          disabled={busy || disabled}
          onClick={() => void connect(false)}
          title="Actualiser la liste"
          aria-label="Actualiser la liste"
        >
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={busy || disabled}
          onClick={() => void disconnect()}
          title={`Se déconnecter (${state.login})`}
          aria-label="Se déconnecter"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="max-h-72 overflow-y-auto rounded-md border" role="listbox" aria-label="Sauvegardes Sudokeys">
        {groups.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            {state.backups.length
              ? "Aucune sauvegarde ne correspond."
              : "Aucune sauvegarde disponible pour ton compte."}
          </p>
        )}
        {groups.map(([project, backups]) => (
          <div key={project}>
            <div className="sticky top-0 border-b bg-muted px-3 py-1.5 text-xs font-semibold">{project}</div>
            {backups.map((backup) => {
              const active = selected?.id === backup.id;
              return (
                <button
                  key={backup.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={disabled}
                  onClick={() => onSelect(backup)}
                  className={cn(
                    "flex w-full min-w-0 items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-hover",
                    active && "bg-primary/10",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block break-all font-medium">{backup.database}</span>
                    <span className="block text-xs text-muted-foreground">
                      Branche {backup.branch} · {formatBackupDate(backup.last_modified)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatBytes(backup.size)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {state.ignored > 0 && (
        <p className="text-xs text-muted-foreground">
          {state.ignored} fichier(s) au nom inattendu ne sont pas affichés : préviens l’équipe infrastructure.
        </p>
      )}
    </div>
  );
}
