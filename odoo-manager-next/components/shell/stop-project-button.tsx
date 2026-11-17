import { cn } from "@/lib/utils";

/**
 * Bouton pour éteindre un projet : même format que le bouton ▶ de la liste, en rouge.
 * Le carré est un peu plus petit que le triangle, sinon il paraît plus lourd à taille égale.
 */
export function StopProjectButton({
  name,
  onStop,
  className,
}: {
  name: string;
  onStop: (name: string) => Promise<void>;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md bg-destructive text-destructive-foreground shadow-sm transition-opacity hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      title={`Arrêter ${name}`}
      aria-label={`Arrêter ${name}`}
      onClick={() => void onStop(name)}
    >
      <span className="h-2 w-2 rounded-[2px] bg-current" aria-hidden="true" />
    </button>
  );
}
