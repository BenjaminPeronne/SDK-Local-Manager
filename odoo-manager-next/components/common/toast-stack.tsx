import type { Toast } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Notifications en bas à droite ; `raised` les remonte au-dessus de la barre d'actions flottante. */
export function ToastStack({ toasts, raised }: { toasts: Toast[]; raised: boolean }) {
  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 right-4 z-50 grid gap-2 sm:left-auto sm:w-96",
        raised && "bottom-28 xl:bottom-20",
      )}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "w-full whitespace-pre-line break-words rounded-md border bg-card p-3 text-sm shadow-lg",
            toast.kind === "error" &&
              "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
            toast.kind === "success" &&
              "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
          )}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
