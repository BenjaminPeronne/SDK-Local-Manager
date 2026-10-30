"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, LogIn, LogOut, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/api";
import type { StoredRikaCredentials } from "@/lib/desktop";
import { formatBytes } from "@/lib/format";
import type { RemoteBackup, RemoteBackupsState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatBackupDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

async function storedSudokeysCredentials(): Promise<StoredRikaCredentials | null> {
  try {
    return (await window.sdkDesktop?.rikaCredentials()) ?? null;
  } catch {
    return null;
  }
}

/** Choix d'une sauvegarde d'un client Sudokeys.
 *
 * Le compte est celui de RIKA : les identifiants déjà mémorisés dans le coffre-fort du système (création
 * d'un projet depuis RIKA, Paramètres) servent directement, sans rien redemander.
 */
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
  const [credentialStore, setCredentialStore] = useState<StoredRikaCredentials | null>(null);
  const [remember, setRemember] = useState(true);

  async function list(credentials: { login: string; password: string } | null) {
    const result = await api<RemoteBackupsState>("/api/remote-backups", {
      method: "POST",
      body: JSON.stringify(credentials ?? {}),
    });
    setState(result);
    setPassword("");
    if (selected && !result.backups.some((backup) => backup.id === selected.id)) onSelect(null);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [current, stored] = await Promise.all([
        api<RemoteBackupsState>("/api/remote-backups"),
        storedSudokeysCredentials(),
      ]);
      if (cancelled) return;
      setCredentialStore(stored);
      setLogin((value) => value || stored?.login || current.login);
      if (current.connected || !stored?.login || !stored.password) {
        setState(current);
        return;
      }
      // Compte mémorisé : connexion directe, le formulaire ne sert qu'en cas de refus.
      setBusy(true);
      try {
        await list({ login: stored.login, password: stored.password });
      } catch (err) {
        if (cancelled) return;
        setState(current);
        setError(
          `${err instanceof Error ? err.message : "Connexion impossible."} Les identifiants mémorisés ont été refusés : saisis le mot de passe actuel.`,
        );
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    load().catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Lecture impossible."));
    return () => {
      cancelled = true;
    };
    // Chargé une fois à l'ouverture de l'onglet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(withPassword: boolean) {
    setBusy(true);
    setError("");
    const credentials = withPassword ? { login: login.trim(), password } : null;
    try {
      await list(credentials);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible.");
      return;
    } finally {
      setBusy(false);
    }
    if (credentials && remember && credentialStore?.available) {
      try {
        // Même compte que RIKA : la création d'un projet en profitera aussi.
        await window.sdkDesktop?.saveRikaCredentials(credentials.login, credentials.password);
      } catch {
        // La liste est affichée : un échec du coffre-fort ne doit pas la masquer.
      }
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
            <Loader2 className="h-4 w-4 animate-spin" />
            {busy ? "Connexion avec ton compte Sudokeys mémorisé…" : "Chargement…"}
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
          Connecte-toi avec ton compte Sudokeys (le même que pour RIKA) pour voir les sauvegardes des clients auxquels
          tu as accès.
        </p>
        <label className="grid gap-1.5 text-sm font-medium">
          Identifiant Sudokeys
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
        {credentialStore?.available && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={remember}
              disabled={busy || disabled}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            <span>
              Mémoriser sur cet ordinateur
              <span className="block text-xs text-muted-foreground">
                Dans le coffre-fort du système, comme pour RIKA : plus besoin de les saisir ici ni à la création d’un
                projet.
              </span>
            </span>
          </label>
        )}
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

      <div className="max-h-72 overflow-y-auto rounded-md border" role="group" aria-label="Sauvegardes Sudokeys">
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
                  aria-pressed={active}
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
