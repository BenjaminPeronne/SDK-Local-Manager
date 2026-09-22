import { DropdownMenu } from "@radix-ui/themes";
import { Languages, MoreHorizontal, PackageX, PlusCircle, RefreshCcw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { REFINED_FOCUS_RING } from "@/components/common/refined-layout";

export type ModuleSelectionBarProps = {
  /** Barre flottante en bas d'écran, affichée quand le bandeau de sélection est sorti de la vue. */
  floating?: boolean;
  selectedCount: number;
  installableModules: string[];
  installedModules: string[];
  removableModules: string[];
  filteredCount: number;
  allFilteredSelected: boolean;
  busy: boolean;
  loading: boolean;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onInstall: (modules: string[]) => void;
  onUpdate: (modules: string[]) => void;
  onUninstall: (modules: string[]) => void;
  onResetTranslations: (modules: string[]) => void;
  onDeleteCode: (modules: string[]) => void;
};

/** Sélection de modules : case globale, résumé et actions applicables à la sélection. */
export function ModuleSelectionBar({
  floating = false,
  selectedCount: count,
  installableModules,
  installedModules,
  removableModules,
  filteredCount,
  allFilteredSelected,
  busy,
  loading,
  onSelectAllFiltered,
  onClearSelection,
  onInstall,
  onUpdate,
  onUninstall,
  onResetTranslations,
  onDeleteCode,
}: ModuleSelectionBarProps) {
  const installable = installableModules.length;
  const installed = installedModules.length;
  const removable = removableModules.length;
  const details = [installable && `${installable} disponible(s)`, installed && `${installed} installé(s)`].filter(Boolean).join(", ");
  const selectAllFiltered = !allFilteredSelected && filteredCount > 0 && (
    <button
      type="button"
      className={cn("shrink-0 rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline", REFINED_FOCUS_RING)}
      onClick={() => onSelectAllFiltered()}
    >
      Tout sélectionner ({filteredCount})
    </button>
  );

  if (!count) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/45 px-3 py-2.5 text-sm">
        <Checkbox
          checked={false}
          disabled={!filteredCount}
          onCheckedChange={() => onSelectAllFiltered()}
          aria-label={`Sélectionner les ${filteredCount} modules affichés par la recherche`}
        />
        <span className="min-w-0 flex-1 text-muted-foreground">Coche des modules pour agir dessus.</span>
        {selectAllFiltered}
      </div>
    );
  }

  // Seules les actions applicables sont proposées ; l'action la plus probable est pleine.
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm",
        floating
          ? "floating-selection-bar pointer-events-auto max-w-full justify-center rounded-xl border border-primary/45 p-2 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.45)] ring-1 ring-black/5 dark:ring-white/10"
          : "rounded-md border border-primary/35 bg-primary/[0.06] px-3 py-2 dark:bg-primary/[0.12]",
      )}
    >
      {/* Deux groupes : en largeur réduite, les actions passent ensemble à la ligne, jamais bouton par bouton. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Checkbox
          checked={allFilteredSelected && count === filteredCount ? true : "indeterminate"}
          onCheckedChange={onClearSelection}
          aria-label="Désélectionner tous les modules"
          title="Désélectionner tous les modules"
        />
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 pr-1">
          <span className="font-semibold">{count} sélectionné(s)</span>
          {details && <span className="text-muted-foreground">· {details}</span>}
        </span>
        {!floating && selectAllFiltered}
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {installable > 0 && (
          <Button
            size="sm"
            variant="success"
            disabled={busy}
            onClick={() => onInstall(installableModules)}
          >
            <PlusCircle className="h-4 w-4" />
            Installer ({installable})
          </Button>
        )}
        {installed > 0 && (
          <Button
            size="sm"
            variant={installable > 0 ? "outline" : "default"}
            disabled={busy}
            onClick={() => onUpdate(installedModules)}
          >
            <RefreshCcw className="h-4 w-4" />
            Mettre à jour ({installed})
          </Button>
        )}
        {installed > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="border-red-300 text-red-700 hover:border-red-400 hover:bg-red-50 hover:text-red-800 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/60"
            disabled={busy}
            onClick={() => onUninstall(installedModules)}
          >
            <PackageX className="h-4 w-4" />
            Désinstaller ({installed})
          </Button>
        )}
        {(installed > 0 || removable > 0) && (
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger>
              <Button size="sm" variant="outline" disabled={loading} aria-label="Autres actions sur la sélection">
                <MoreHorizontal className="h-4 w-4" />
                Plus
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" className="min-w-60">
              <DropdownMenu.Item disabled={!installed || busy} onSelect={() => onResetTranslations(installedModules)}>
                <Languages className="h-4 w-4" />
                Réinitialiser les traductions ({installed})
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red" disabled={!removable} onSelect={() => onDeleteCode(removableModules)}>
                <Trash2 className="h-4 w-4" />
                Supprimer le code du projet ({removable})
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        )}
        <span className="mx-0.5 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <Button size="sm" variant="ghost" onClick={onClearSelection} title="Désélectionner tous les modules (Échap)">
          <X className="h-4 w-4" />
          Désélectionner
          <kbd className="ml-0.5 rounded border px-1 font-mono text-[10px] font-normal text-muted-foreground">Échap</kbd>
        </Button>
      </div>
    </div>
  );
}
