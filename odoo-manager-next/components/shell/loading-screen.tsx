import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";
import type { StaticImageData } from "next/image";
import type { BackendDiagnostics } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type LoadingScreenProps = {
  appIcon: StaticImageData;
  roundIcon: boolean;
  message: string;
  error: string;
  diagnostics: BackendDiagnostics | null;
  onRetry: () => void;
};

/** Écran affiché pendant le démarrage du service local, avec l'erreur et les diagnostics s'il échoue. */
export function LoadingScreen({ appIcon, roundIcon, message, error, diagnostics, onRetry }: LoadingScreenProps) {
  return (
    <main className="sdk-shell grid min-h-screen place-items-center bg-background px-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <img
          src={appIcon.src}
          alt="SDK Local Manager"
          className={cn("mx-auto h-16 w-16 object-cover", roundIcon ? "rounded-full" : "rounded-[15px]")}
        />
        <div className="mt-3 flex justify-center">
          {error ? (
            <AlertTriangle className="h-6 w-6 text-amber-600" />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          )}
        </div>
        <h1 className="mt-4 text-lg font-semibold">Chargement du gestionnaire</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {error && (
          <div className="mt-4 space-y-3">
            <p className="break-words rounded-md border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              {error}
            </p>
            {diagnostics && (
              <details className="rounded-md border bg-muted/40 p-3 text-left text-xs">
                <summary className="cursor-pointer font-medium">Détails techniques</summary>
                <div className="mt-2 break-all text-muted-foreground">Journal : {diagnostics.log_path}</div>
                <pre className="log-terminal mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-2 text-[11px] text-slate-100">
                  {diagnostics.details}
                </pre>
              </details>
            )}
            <Button className="w-full" onClick={onRetry}>
              <RefreshCcw className="h-4 w-4" />
              Réessayer
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
