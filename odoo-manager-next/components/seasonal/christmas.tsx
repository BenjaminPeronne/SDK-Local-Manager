import type { CSSProperties } from "react";

/**
 * Bonnet enfilé en biais sur le coin haut droit d'un logo, la pointe retombant sur le côté
 * (placement : `.sdk-season-hat-christmas`) ; le parent doit être positionné.
 */
export function ChristmasHat() {
  return (
    <svg viewBox="0 0 40 32" aria-hidden="true" className="sdk-season-hat sdk-season-hat-christmas">
      <path
        d="M5 25 C6 13 13 5 21 4.5 C28 4 33 8 34.5 16 C32 13.5 29.5 12.5 27.5 14 C29.5 17.5 30.5 21.5 31 25 Z"
        fill="#d72f2f"
      />
      <path d="M27.5 14 C29.5 12.5 32 13.5 34.5 16 C33.5 10 29 6.5 24 6 C27.5 8 28.5 11 27.5 14 Z" fill="#a91f22" />
      <path
        d="M9 22 C10 14.5 14 9.5 19 7.5"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.28"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M2.5 24 Q18 19.5 33.5 24 Q35.5 27 33.5 30 Q18 25.5 2.5 30 Q0.5 27 2.5 24 Z"
        fill="#fff"
        stroke="#000"
        strokeOpacity="0.12"
      />
      <circle cx="34.5" cy="17.5" r="3.6" fill="#fff" stroke="#000" strokeOpacity="0.12" />
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
