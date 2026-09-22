import { Dialog as RadixDialog, IconButton } from "@radix-ui/themes";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof RadixDialog.Content>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Content>
>(({ className, children, ...props }, ref) => (
  <RadixDialog.Content
    ref={ref}
    size="3"
    // Rythme vertical par défaut : sans lui, chaque fenêtre recollait son en-tête, son contenu et
    // ses boutons, et chaque nouvelle fenêtre naissait avec des blocs collés. Une fenêtre à mise
    // en page propre le remplace par sa classe `gap-*`.
    className={cn(
      "relative flex max-h-[calc(100dvh-2rem-max(2rem,6dvh))] w-[calc(100vw-2rem)] max-w-lg flex-col gap-5 overflow-y-auto",
      className,
    )}
    {...props}
  >
    {children}
    <RadixDialog.Close>
      {/* Variante « soft » : la croix a un fond visible au repos, là où la variante fantôme
          la laissait se confondre avec le fond de la fenêtre. */}
      <IconButton
        className="absolute right-3 top-3"
        size="2"
        variant="soft"
        color="gray"
        aria-label="Fermer"
        title="Fermer"
      >
        <X className="h-4 w-4" />
      </IconButton>
    </RadixDialog.Close>
  </RadixDialog.Content>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof RadixDialog.Title>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...props }, ref) => (
  <RadixDialog.Title ref={ref} className={cn("!mb-0 text-lg font-semibold", className)} {...props} />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof RadixDialog.Description>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(({ className, ...props }, ref) => (
  <RadixDialog.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";

/** Boutons de fin de fenêtre : empilés sur mobile, action principale à droite sur écran large. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}
