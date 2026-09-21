import { Card as RadixCard } from "@radix-ui/themes";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentPropsWithoutRef<typeof RadixCard>) {
  return <RadixCard size="1" variant="surface" className={cn("min-w-0 overflow-hidden bg-card shadow-sm", className)} {...props} />;
}

// Survol : fond `hover` et anneau orangé. La bordure seule ne suffisait pas, Radix la dessine
// autrement ; une carte déjà sélectionnée (`bg-selected`) garde sa teinte sous le pointeur.
export function InteractiveCard({ className, type = "button", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <RadixCard asChild size="1" variant="surface">
      <button
        type={type}
        className={cn(
          "min-w-0 cursor-pointer bg-card text-left transition-[background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-md hover:ring-1 hover:ring-primary/40 [&:not(.bg-selected):hover]:bg-hover active:translate-y-0 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className,
        )}
        {...props}
      />
    </RadixCard>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 border-b p-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold leading-none", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}
