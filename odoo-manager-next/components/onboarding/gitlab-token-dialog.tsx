"use client";

import { type ReactNode, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { desktopErrorMessage, type GitLabStatus } from "@/lib/desktop";
import { GITLAB_TOKEN_URL, gitlabTokenDate, gitlabTokenNotice } from "@/lib/gitlab-token";
import type { Toast } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type GitLabTokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: GitLabStatus | null;
  onConnected: (status: GitLabStatus) => void;
  openUrl: (url?: string) => Promise<void>;
  pushToast: (kind: Toast["kind"], message: string) => void;
};

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-md border p-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-sm font-medium">{title}</div>
        {children}
      </div>
    </li>
  );
}

/**
 * Assistant pas à pas pour relier GitLab : créer un jeton en lecture seule, puis le coller ici.
 *
 * Le jeton est facultatif : il n'active que la recherche de dépôts par leur nom. Il reste chiffré
 * sur cet ordinateur, dans le processus de l'application ; l'interface ne le revoit jamais.
 */
export function GitLabTokenDialog({
  open,
  onOpenChange,
  status,
  onConnected,
  openUrl,
  pushToast,
}: GitLabTokenDialogProps) {
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState<GitLabStatus | null>(null);
  const notice = gitlabTokenNotice(status);
  const warning = notice
    ? `${notice.text} Crée un nouveau jeton en suivant ces trois étapes : il remplacera l’ancien.`
    : status?.unreadable
      ? status.reason
      : "";
  const replacing = Boolean(status?.connected || status?.expired);

  function changeOpen(next: boolean) {
    if (!next) {
      setToken("");
      setError("");
      setConnected(null);
    }
    onOpenChange(next);
  }

  async function activate() {
    const bridge = window.sdkDesktop;
    if (!bridge || !token.trim()) return;
    setChecking(true);
    setError("");
    try {
      const result = await bridge.gitlabConnect(token);
      setToken("");
      setConnected(result);
      onConnected(result);
      pushToast(
        "success",
        replacing ? "Jeton GitLab remplacé." : "GitLab connecté : la recherche de dépôts est activée.",
      );
    } catch (err) {
      setError(desktopErrorMessage(err, "GitLab n’a pas accepté ce jeton."));
    } finally {
      setChecking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{replacing ? "Remplacer le jeton GitLab" : "Connecter GitLab"}</DialogTitle>
          <DialogDescription>
            Facultatif : permet de retrouver un dépôt et sa branche par leur nom, au lieu de coller leur lien SSH. Le
            jeton ne donne qu’un accès en lecture et reste chiffré sur cet ordinateur.
          </DialogDescription>
        </DialogHeader>

        {connected ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <div className="font-medium">
                  GitLab est connecté{connected.username ? ` en tant que @${connected.username}` : ""}.
                </div>
                <p className="text-xs leading-5">
                  {connected.expiresAt
                    ? `Le jeton expire le ${gitlabTokenDate(connected.expiresAt)} : l’application te préviendra une semaine avant.`
                    : "GitLab n’a pas indiqué de date d’expiration pour ce jeton."}{" "}
                  Tu peux maintenant choisir « Rechercher dans GitLab » pour importer des modules ou créer un projet.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => changeOpen(false)}>Terminer</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {warning && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
                {warning}
              </p>
            )}
            <ol className="space-y-3">
              <Step number={1} title="Ouvre la page des jetons sur GitLab">
                <p className="text-xs leading-5 text-muted-foreground">
                  Le nom « SDK Local Manager » et le droit en lecture seule (read_api) y sont déjà remplis.
                </p>
                <Button type="button" variant="outline" onClick={() => void openUrl(GITLAB_TOKEN_URL)}>
                  <ExternalLink className="h-4 w-4" />
                  Ouvrir GitLab
                </Button>
              </Step>
              <Step number={2} title="Crée le jeton sur GitLab">
                <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                  <li>
                    Choisis une <span className="font-medium text-foreground">date d’expiration lointaine</span>, la
                    plus éloignée que GitLab accepte : l’application te préviendra une semaine avant.
                  </li>
                  <li>Laisse seule la case read_api cochée : c’est tout ce dont l’application a besoin.</li>
                  <li>Valide avec le bouton de création en bas du formulaire.</li>
                  <li>
                    <span className="font-medium text-foreground">Copie le jeton</span> affiché en haut de la page (il
                    commence par glpat-) : GitLab ne le montre qu’une seule fois.
                  </li>
                </ul>
              </Step>
              <Step number={3} title="Colle le jeton ici">
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void activate();
                  }}
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="glpat-…"
                    aria-label="Jeton personnel GitLab"
                    autoFocus
                  />
                  <Button type="submit" className="shrink-0" disabled={checking || !token.trim()}>
                    {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    Vérifier et activer
                  </Button>
                </form>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </Step>
            </ol>
            <p className="text-xs leading-5 text-muted-foreground">
              Sans jeton, tout le gestionnaire fonctionne : seule la recherche de dépôts par leur nom est désactivée, et
              le lien SSH reste disponible.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
