import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Bonnet posé en biais sur le coin d'un logo ; le parent doit être positionné. */
export function ChristmasHat({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 26"
      aria-hidden="true"
      className={cn("sdk-christmas-hat pointer-events-none absolute rotate-[18deg]", className)}
    >
      <path d="M5 20 Q9 5 21 3 Q27 2.5 28.5 9 Q24.5 7 21.5 9.5 Q25 14 26 20 Z" fill="#d72f2f" />
      <path d="M21.5 9.5 Q24.5 7 28.5 9 Q27 2.5 21 3 Q24 5 21.5 9.5 Z" fill="#a91f22" />
      <rect x="2.5" y="18" width="26" height="6.5" rx="3.25" fill="#fff" stroke="#000" strokeOpacity="0.12" />
      <circle cx="28.5" cy="9" r="3.2" fill="#fff" stroke="#000" strokeOpacity="0.12" />
    </svg>
  );
}

// Positions fixes plutôt qu'aléatoires : même rendu à chaque ouverture et pendant le prérendu.
const SNOWFLAKES = Array.from({ length: 28 }, (_, index) => {
  const spread = (index * 0.618034) % 1;
  return {
    left: `${(spread * 100).toFixed(1)}%`,
    size: `${3 + (index % 4)}px`,
    duration: `${9 + ((index * 7) % 8)}s`,
    delay: `-${((index * 3.7) % 14).toFixed(1)}s`,
    drift: `${(index % 2 ? 1 : -1) * (12 + ((index * 5) % 24))}px`,
  };
});

/** Quelques flocons qui tombent derrière le contenu ; le parent doit être positionné et isolé (`isolate`). */
export function Snowfall() {
  return (
    <div className="sdk-snowfall pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {SNOWFLAKES.map((flake, index) => (
        <span
          key={index}
          className="sdk-snowflake"
          style={
            {
              left: flake.left,
              "--flake-size": flake.size,
              "--flake-duration": flake.duration,
              "--flake-delay": flake.delay,
              "--flake-drift": flake.drift,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
