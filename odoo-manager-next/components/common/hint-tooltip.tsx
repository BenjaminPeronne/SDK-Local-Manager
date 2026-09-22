"use client";

import { Info } from "lucide-react";

export function HintTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex" onClick={(event) => event.preventDefault()}>
      <span
        tabIndex={0}
        aria-label={text}
        className="inline-flex cursor-help rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5" />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-64 -translate-x-1/2 rounded-md border bg-card px-3 py-2 text-xs font-normal leading-snug text-card-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
