import type { CSSProperties } from "react";

/** Chapeau de sorcière posé sur le haut d'un logo (placement : `.sdk-season-hat`) ; le parent doit être positionné. */
export function WitchHat() {
  return (
    <svg viewBox="0 0 32 26" aria-hidden="true" className="sdk-season-hat">
      <ellipse cx="16" cy="21.5" rx="15" ry="3.5" fill="#3b2056" stroke="#fff" strokeOpacity="0.18" />
      <path d="M8 21 Q11 12 15 6 Q18 1 26 3 Q20 5 19.5 10 Q21 16 24 21 Z" fill="#5b3486" />
      <rect x="8.6" y="16.5" width="14.8" height="3.6" rx="0.8" fill="#f4791f" />
      <rect x="14.2" y="16" width="3.6" height="4.6" rx="0.6" fill="none" stroke="#f2b632" strokeWidth="1.2" />
    </svg>
  );
}

// Positions fixes plutôt qu'aléatoires : même rendu à chaque ouverture et pendant le prérendu.
const BATS = Array.from({ length: 6 }, (_, index) => ({
  top: `${8 + ((index * 37) % 48)}%`,
  size: `${24 + ((index * 5) % 12)}px`,
  duration: `${15 + ((index * 3) % 8)}s`,
  delay: `-${((index * 4.3) % 18).toFixed(1)}s`,
  // Une sur deux traverse dans l'autre sens.
  direction: index % 2 ? "reverse" : "normal",
}));

/** Quelques chauves-souris qui traversent derrière le contenu ; le parent doit être positionné et isolé. */
export function Bats() {
  return (
    <div className="sdk-bats pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {BATS.map((bat, index) => (
        <span
          key={index}
          className="sdk-bat"
          style={
            {
              top: bat.top,
              "--bat-size": bat.size,
              "--bat-duration": bat.duration,
              "--bat-delay": bat.delay,
              "--bat-direction": bat.direction,
            } as CSSProperties
          }
        >
          <svg viewBox="0 0 40 18" className="sdk-bat-wings">
            <path
              d="M20 6 Q18 3 17.5 5 Q14 1 6 2 Q9 5 7 8 Q3 8 0 10 Q8 10 11 15 Q13 11 17 13 Q19 11 20 14 Q21 11 23 13 Q27 11 29 15 Q32 10 40 10 Q37 8 33 8 Q31 5 34 2 Q26 1 22.5 5 Q22 3 20 6 Z"
              fill="currentColor"
            />
          </svg>
        </span>
      ))}
    </div>
  );
}
