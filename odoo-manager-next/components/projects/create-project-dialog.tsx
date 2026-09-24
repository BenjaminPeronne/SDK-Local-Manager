"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FolderPlus, Loader2, RefreshCcw } from "lucide-react";
import type { GitLabStatus, StoredRikaCredentials } from "@/lib/desktop";
import type { ProjectCreationPrerequisites } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InteractiveCard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  defaultRepositorySource,
  GitLabRepositoryPicker,
  type RepositorySource,
  RepositorySourceToggle,
} from "@/components/gitlab-repository-picker";

const RIKA_AUTO_VERSION = "auto";

export function PrerequisiteRow({
  ready,
  icon: Icon,
  title,
  detail,
  action,
}: {
  ready: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div
          className={cn(
            "mt-0.5 rounded-md p-2",
            ready
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium">
            {title}
            {ready ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            )}
          </div>
          <div className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">{detail}</div>
        </div>
      </div>
      {action && <div className="shrink-0 pl-12 sm:pl-0">{action}</div>}
    </div>
  );
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  prerequisites,
  dockerReady,
  loading,
  onRefreshPrerequisites,
  onSubmit,
  onManageGitlab,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prerequisites: ProjectCreationPrerequisites | null;
  dockerReady: boolean;
  loading: boolean;
  onRefreshPrerequisites: () => Promise<ProjectCreationPrerequisites | null>;
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
  onManageGitlab: () => void;
}) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("19.0");
  // RIKA : la version vient de la copie ; le choix manuel ne sert que si la copie ne la donne pas.
  const [rikaVersion, setRikaVersion] = useState(RIKA_AUTO_VERSION);
  const [sourceType, setSourceType] = useState<"standard" | "gitlab" | "rika">("standard");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryBranch, setRepositoryBranch] = useState("master");
  const [repositorySource, setRepositorySource] = useState<RepositorySource>("ssh");
  const [gitlabStatus, setGitlabStatus] = useState<GitLabStatus | null>(null);
  const [rikaInstance, setRikaInstance] = useState("");
  const [rikaLogin, setRikaLogin] = useState("");
  const [rikaPassword, setRikaPassword] = useState("");
  const [startAfterCreation, setStartAfterCreation] = useState(true);
  const [credentialStore, setCredentialStore] = useState<StoredRikaCredentials | null>(null);
  const [rememberRikaLogin, setRememberRikaLogin] = useState(false);
  const [rememberRikaPassword, setRememberRikaPassword] = useState(false);

  useEffect(() => {
    if (!open) {
      setRikaPassword("");
      setCredentialStore(null);
      return;
    }
    const bridge = window.sdkDesktop;
    if (!bridge) return;
    let cancelled = false;
    bridge
      .rikaCredentials()
      .then((stored) => {
        if (cancelled) return;
        setCredentialStore(stored);
        setRememberRikaLogin(Boolean(stored.login));
        setRememberRikaPassword(Boolean(stored.password));
        if (stored.login) setRikaLogin((current) => current || stored.login);
        if (stored.password) setRikaPassword((current) => current || stored.password);
      })
      .catch(() => {
        if (!cancelled) setCredentialStore(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStartAfterCreation(dockerReady);
    if (prerequisites?.supported_versions?.length && !prerequisites.supported_versions.includes(version)) {
      setVersion(prerequisites.supported_versions.at(-1) || "19.0");
    }
  }, [dockerReady, open, prerequisites?.supported_versions, version]);

  // Compte GitLab connecté : le dépôt d'addons se choisit dans la liste plutôt que par son URL.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.sdkDesktop
      ?.gitlabStatus()
      .then((status) => {
        if (cancelled) return;
        setGitlabStatus(status);
        setRepositorySource(defaultRepositorySource(status));
      })
      .catch(() => {
        if (!cancelled) setGitlabStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const hasStoredRikaCredentials = Boolean(credentialStore?.login);

  async function forgetRikaCredentials() {
    await window.sdkDesktop?.clearRikaCredentials();
    setCredentialStore((current) => current && { ...current, login: "", password: "", reason: "" });
    setRememberRikaLogin(false);
    setRememberRikaPassword(false);
  }

  async function submitProject() {
    const created = await onSubmit({
      name: name.trim(),
      version: sourceType === "rika" ? (rikaVersion === RIKA_AUTO_VERSION ? "" : rikaVersion) : version,
      source_type: sourceType,
      repository_url: repositoryUrl.trim(),
      repository_branch: repositoryBranch.trim(),
      rika_instance: rikaInstance.trim(),
      rika_login: rikaLogin.trim(),
      rika_password: rikaPassword,
      start_after_creation: startAfterCreation,
    });
    const bridge = window.sdkDesktop;
    if (!created || sourceType !== "rika" || !bridge || !credentialStore?.available) return;
    try {
      if (rememberRikaLogin) {
        await bridge.saveRikaCredentials(rikaLogin.trim(), rememberRikaPassword ? rikaPassword : null);
      } else if (hasStoredRikaCredentials) {
        await bridge.clearRikaCredentials();
      }
    } catch {
      // La création est lancée : un échec du trousseau ne doit pas la bloquer.
    }
  }

  const prerequisitesReady = Boolean(
    prerequisites?.workspace_ready && prerequisites.git_available && prerequisites.ssh_key_present,
  );
  const sourceFieldsReady =
    sourceType === "standard" ||
    (sourceType === "gitlab" && Boolean(repositoryUrl.trim() && repositoryBranch.trim())) ||
    (sourceType === "rika" && Boolean(rikaInstance.trim() && rikaLogin.trim() && rikaPassword));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Créer un projet Odoo local</DialogTitle>
          <DialogDescription>
            Le gestionnaire prépare Odoo, Enterprise, Docker et les liens d’addons sans ouvrir de terminal.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <div className="grid content-start gap-1.5 text-sm font-medium">
              <label htmlFor="new-project-name">Nom du projet</label>
              <Input
                id="new-project-name"
                value={name}
                maxLength={63}
                onChange={(event) => setName(event.target.value)}
                placeholder="CLIENT_V19"
                autoFocus
              />
              <span className="min-h-4 text-xs font-normal text-muted-foreground">
                Lettres, chiffres, tirets, points et underscores.
              </span>
            </div>
            <div className="grid content-start gap-1.5 text-sm font-medium">
              <label htmlFor="new-project-version">Version Odoo</label>
              <Select
                value={sourceType === "rika" ? rikaVersion : version}
                onValueChange={sourceType === "rika" ? setRikaVersion : setVersion}
              >
                <SelectTrigger id="new-project-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceType === "rika" && (
                    <SelectItem value={RIKA_AUTO_VERSION}>Détecter automatiquement</SelectItem>
                  )}
                  {(prerequisites?.supported_versions || ["15.0", "16.0", "17.0", "18.0", "19.0"]).map((item) => (
                    <SelectItem key={item} value={item}>
                      Odoo {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="min-h-4 text-xs font-normal text-muted-foreground">
                {sourceType !== "rika"
                  ? " "
                  : rikaVersion === RIKA_AUTO_VERSION
                    ? "Lue dans la copie RIKA ; choisis-la si la copie ne l'indique pas."
                    : "Utilisée si la copie RIKA ne l'indique pas ; refusée si la copie est d'une autre version."}
              </span>
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Source du projet</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <InteractiveCard
                className={cn("min-h-20 p-3", sourceType === "standard" && "border-primary bg-selected")}
                onClick={() => setSourceType("standard")}
              >
                <span className="block font-medium">Odoo standard</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Odoo Community et Enterprise Sudokeys.
                </span>
              </InteractiveCard>
              <InteractiveCard
                className={cn("min-h-20 p-3", sourceType === "gitlab" && "border-primary bg-selected")}
                onClick={() => setSourceType("gitlab")}
              >
                <span className="block font-medium">Dépôt d’addons GitLab</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Ajoute le dépôt client au socle standard.
                </span>
              </InteractiveCard>
              <InteractiveCard
                className={cn("min-h-20 p-3", sourceType === "rika" && "border-primary bg-selected")}
                onClick={() => setSourceType("rika")}
              >
                <span className="block font-medium">Copie depuis RIKA</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Récupère une instance et détecte sa version Odoo.
                </span>
              </InteractiveCard>
            </div>
          </fieldset>

          {sourceType === "gitlab" && (
            <div className="grid gap-3 border-l-2 border-primary pl-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Dépôt d’addons</span>
                <RepositorySourceToggle value={repositorySource} onChange={setRepositorySource} status={gitlabStatus} />
              </div>
              {repositorySource === "gitlab" && (gitlabStatus?.available || gitlabStatus?.unreadable) ? (
                <GitLabRepositoryPicker
                  status={gitlabStatus}
                  url={repositoryUrl}
                  branch={repositoryBranch}
                  // La branche au nom de la version Odoo, sinon la branche par défaut du dépôt.
                  preferredBranches={[version]}
                  preferDefaultBranch
                  onChange={({ url, branch }) => {
                    setRepositoryUrl(url);
                    setRepositoryBranch(branch);
                  }}
                  onManageAccount={onManageGitlab}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <label className="grid min-w-0 gap-1.5 text-sm font-medium">
                    URL SSH du dépôt d’addons
                    <Input
                      value={repositoryUrl}
                      onChange={(event) => setRepositoryUrl(event.target.value)}
                      placeholder="ssh://git@gitlab.sudokeys.com:10022/sudokeys/client-addons.git"
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    Branche
                    <Input
                      value={repositoryBranch}
                      onChange={(event) => setRepositoryBranch(event.target.value)}
                      placeholder="master"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {sourceType === "rika" && (
            <div className="grid gap-3 border-l-2 border-primary pl-4 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1.5 text-sm font-medium sm:col-span-2">
                Instance RIKA
                <Input
                  value={rikaInstance}
                  onChange={(event) => setRikaInstance(event.target.value)}
                  placeholder="prod01"
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-medium">
                Identifiant Sudokeys
                <Input
                  value={rikaLogin}
                  onChange={(event) => setRikaLogin(event.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-medium">
                Mot de passe
                <Input
                  type="password"
                  value={rikaPassword}
                  onChange={(event) => setRikaPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              {credentialStore?.available ? (
                <div className="grid gap-2 rounded-md border bg-muted/35 p-3 text-sm sm:col-span-2">
                  <label className="flex items-start gap-2">
                    <Checkbox
                      className="mt-0.5"
                      checked={rememberRikaLogin}
                      onCheckedChange={(checked) => {
                        setRememberRikaLogin(checked === true);
                        if (checked !== true) setRememberRikaPassword(false);
                      }}
                    />
                    <span>Mémoriser mon identifiant sur cet ordinateur</span>
                  </label>
                  <label className={cn("flex items-start gap-2 pl-6", !rememberRikaLogin && "opacity-50")}>
                    <Checkbox
                      className="mt-0.5"
                      checked={rememberRikaPassword}
                      disabled={!rememberRikaLogin}
                      onCheckedChange={(checked) => setRememberRikaPassword(checked === true)}
                    />
                    <span>Mémoriser aussi le mot de passe</span>
                  </label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Chiffrés par le coffre-fort du système (Trousseau macOS, DPAPI Windows, trousseau Linux) et
                    enregistrés uniquement si la création démarre. Décocher puis créer efface les identifiants
                    mémorisés.
                  </p>
                  {credentialStore.reason && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{credentialStore.reason}</p>
                  )}
                  {hasStoredRikaCredentials && (
                    <button
                      type="button"
                      className="justify-self-start text-xs font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => void forgetRikaCredentials()}
                    >
                      Oublier les identifiants enregistrés
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                  {credentialStore?.reason
                    ? `${credentialStore.reason} Les identifiants sont transmis uniquement à RIKA pendant cette création.`
                    : "Ces identifiants sont transmis uniquement à RIKA pendant cette création et ne sont pas enregistrés par le gestionnaire."}
                </p>
              )}
            </div>
          )}

          <label className={cn("flex items-start gap-3 rounded-md border p-3 text-sm", !dockerReady && "bg-muted/40")}>
            <Checkbox
              className="mt-0.5"
              checked={startAfterCreation}
              disabled={!dockerReady}
              onCheckedChange={(checked) => setStartAfterCreation(checked === true)}
            />
            <span>
              <span className="block font-medium">Démarrer le projet après la création</span>
              <span className="block text-xs leading-5 text-muted-foreground">
                {dockerReady
                  ? "Traefik sera installé automatiquement s’il manque."
                  : "Docker n’est pas démarré. Le projet pourra être créé puis démarré plus tard."}
              </span>
            </span>
          </label>

          {!prerequisitesReady && (
            <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Git, le workspace et une clé SSH publique sont requis pour récupérer les dépôts privés.</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => void onRefreshPrerequisites()}>
                <RefreshCcw className="h-4 w-4" />
                Revérifier
              </Button>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              disabled={loading || !name.trim() || !prerequisitesReady || !sourceFieldsReady}
              onClick={() => void submitProject()}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
              Créer le projet
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
