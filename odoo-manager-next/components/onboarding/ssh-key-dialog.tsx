"use client";

import { type Dispatch, type SetStateAction, useState } from "react";
import { Copy, ExternalLink, KeyRound, Loader2, RefreshCcw } from "lucide-react";
import { api } from "@/lib/api";
import type { ProjectCreationPrerequisites, SshPublicKey, Toast } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type SshKeyDialogProps = {
  creationPrerequisites: ProjectCreationPrerequisites | null;
  loadCreationPrerequisites: () => Promise<ProjectCreationPrerequisites | null>;
  loadSshKeys: () => Promise<SshPublicKey[]>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  openUrl: (url?: string) => Promise<void>;
  pushToast: (kind: Toast["kind"], message: string) => void;
  selectedSshKey: SshPublicKey;
  selectedSshKeyName: string;
  setSelectedSshKeyName: Dispatch<SetStateAction<string>>;
  setSshComment: Dispatch<SetStateAction<string>>;
  setSshKeyBackup: Dispatch<SetStateAction<string>>;
  setSshRegenerateConfirmed: Dispatch<SetStateAction<boolean>>;
  setSshRegenerateMode: Dispatch<SetStateAction<boolean>>;
  sshComment: string;
  sshKeyBackup: string;
  sshKeys: SshPublicKey[];
  sshRegenerateConfirmed: boolean;
  sshRegenerateMode: boolean;
  startSshKeyRegeneration: (keys?: SshPublicKey[]) => void;
};

export function SshKeyDialog({ creationPrerequisites, loadCreationPrerequisites, loadSshKeys, onOpenChange, open, openUrl, pushToast, selectedSshKey, selectedSshKeyName, setSelectedSshKeyName, setSshComment, setSshKeyBackup, setSshRegenerateConfirmed, setSshRegenerateMode, sshComment, sshKeyBackup, sshKeys, sshRegenerateConfirmed, sshRegenerateMode, startSshKeyRegeneration }: SshKeyDialogProps) {
  const [generatingSshKey, setGeneratingSshKey] = useState(false);
  async function requestSshKeyGeneration(replace = false) {
    setGeneratingSshKey(true);
    try {
      const key = await api<SshPublicKey & { created: boolean; message: string; backup?: string }>("/api/system/ssh-key/generate", {
        method: "POST",
        body: JSON.stringify({ comment: sshComment, replace }),
      });
      pushToast("success", key.message);
      setSshRegenerateMode(false);
      setSshRegenerateConfirmed(false);
      setSshKeyBackup(key.backup || "");
      await loadSshKeys();
      setSelectedSshKeyName(key.name);
      await loadCreationPrerequisites();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Impossible de générer la clé SSH.");
    } finally {
      setGeneratingSshKey(false);
    }
  }
  async function copySshPublicKey() {
    const key = sshKeys.find((item) => item.name === selectedSshKeyName);
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key.public_key);
      pushToast("success", "Clé publique copiée.");
    } catch {
      pushToast("error", "Impossible de copier la clé publique.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Clé SSH GitLab</DialogTitle>
          <DialogDescription>
            Le gestionnaire génère la clé sur cette machine. Seule la clé publique est affichée et peut être copiée.
          </DialogDescription>
        </DialogHeader>
        {sshKeys.length === 0 ? (
          <div className="space-y-4">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="ssh-key-comment">E-mail professionnel ou commentaire</label>
              <Input
                id="ssh-key-comment"
                value={sshComment}
                onChange={(event) => setSshComment(event.target.value)}
                placeholder="prenom.nom@sudokeys.com"
                autoComplete="email"
              />
              <p className="text-xs text-muted-foreground">Ce texte sert uniquement à identifier la clé dans GitLab.</p>
            </div>
            <Button className="w-full" onClick={() => requestSshKeyGeneration()} disabled={generatingSshKey}>
              {generatingSshKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Générer une clé Ed25519
            </Button>
          </div>
        ) : sshRegenerateMode ? (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100">
              <div className="font-medium">Régénérer la clé id_ed25519</div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">
                <li>Une nouvelle paire de clés remplace <code>~/.ssh/id_ed25519</code> sur cette machine.</li>
                <li>
                  L’ancienne paire n’est pas supprimée : elle est déplacée dans <code>~/.ssh/odoo-manager-backups</code>.
                </li>
                <li>
                  Tant que la nouvelle clé publique n’est pas ajoutée dans GitLab, les imports et mises à jour de dépôts échoueront.
                  Les autres services qui utilisaient l’ancienne clé (serveurs, GitHub…) devront aussi être mis à jour.
                </li>
              </ul>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="ssh-key-regenerate-comment">E-mail professionnel ou commentaire</label>
              <Input
                id="ssh-key-regenerate-comment"
                value={sshComment}
                onChange={(event) => setSshComment(event.target.value)}
                placeholder="prenom.nom@sudokeys.com"
                autoComplete="email"
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={sshRegenerateConfirmed}
                onCheckedChange={(checked) => setSshRegenerateConfirmed(checked === true)}
              />
              J’ai compris que je devrai ajouter la nouvelle clé publique dans GitLab.
            </label>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setSshRegenerateMode(false)} disabled={generatingSshKey}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={() => requestSshKeyGeneration(true)}
                disabled={!sshRegenerateConfirmed || generatingSshKey}
              >
                {generatingSshKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Régénérer la clé
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {sshKeyBackup && (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100">
                <div className="font-medium">Nouvelle clé générée</div>
                <p className="mt-1 text-xs leading-5">
                  Copie-la puis ajoute-la dans GitLab. Pense à retirer l’ancienne clé de GitLab ensuite.
                  Ancienne clé conservée dans : <code className="break-all">{sshKeyBackup}</code>
                </p>
              </div>
            )}
            {sshKeys.length > 1 && (
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="ssh-public-key-select">Clé publique</label>
                <Select value={selectedSshKey?.name || ""} onValueChange={setSelectedSshKeyName}>
                  <SelectTrigger id="ssh-public-key-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sshKeys.map((key) => <SelectItem key={key.name} value={key.name}>{key.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <label className="text-sm font-medium" htmlFor="ssh-public-key">Clé publique à ajouter dans GitLab</label>
              <Textarea
                id="ssh-public-key"
                className="min-h-32 resize-y break-all font-mono text-xs"
                readOnly
                value={selectedSshKey?.public_key || ""}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" onClick={copySshPublicKey} disabled={!selectedSshKey}>
                <Copy className="h-4 w-4" />
                Copier la clé
              </Button>
              <Button
                onClick={() => openUrl(creationPrerequisites?.gitlab_ssh_keys_url)}
                disabled={!creationPrerequisites?.gitlab_ssh_keys_url}
              >
                <ExternalLink className="h-4 w-4" />
                Ouvrir GitLab
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Dans GitLab, colle cette valeur dans le champ Clé SSH, donne-lui un titre correspondant à cet ordinateur, puis valide.
            </p>
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Clé compromise, perdue ou à renouveler ?</p>
              <Button variant="outline" onClick={() => startSshKeyRegeneration()} disabled={generatingSshKey}>
                <RefreshCcw className="h-4 w-4" />
                Régénérer la clé
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
