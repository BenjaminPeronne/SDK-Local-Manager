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

// Aile gauche dans les trois positions du battement ; l'aile droite en est le miroir. Le bord de
// fuite festonné dessine les doigts de l'aile.
const WING_FRAMES = [
  // Ailes hautes.
  "M22 12 L17 6.5 Q13 2 6.5 0.6 Q7.4 3.8 6.6 6.8 Q9.2 6.6 11 8.6 Q11 11.4 12 13.6 Q14.8 13 16.8 14.6 Q19.4 16.2 22 16.6 Z",
  // Ailes à l'horizontale.
  "M22 13 L14 9.5 Q8 8.4 1.5 11.8 Q4.8 13 6.4 15.4 Q8.4 14 10.4 15 Q12 16.8 13 18.6 Q15 16.6 17 17.2 Q19.6 17.8 22 17 Z",
  // Ailes basses.
  "M22 13.6 L15.5 15.2 Q9.5 17.2 4.5 22.6 Q8 22.4 9.4 24 Q10.8 21.8 12.8 21.8 Q14.2 22.2 15.6 23.4 Q16.6 20.8 18.6 19.6 Q20.4 18.6 22 17.6 Z",
];

// Tête à deux oreilles et corps, communs aux trois positions.
const BAT_BODY =
  "M24 7.6 L25.5 5.2 L26.2 9.2 Q27.2 10.6 26.8 12.4 Q27.4 15.2 26.4 18 Q25.4 20.4 24 21 Q22.6 20.4 21.6 18 Q20.6 15.2 21.2 12.4 Q20.8 10.6 21.8 9.2 L22.5 5.2 Z";

// Trois plans : les plus proches sont grandes, nettes et rapides, les lointaines petites, pâles et lentes.
// Valeurs fixes plutôt qu'aléatoires : même rendu à chaque ouverture et pendant le prérendu.
const BATS = [
  { top: "14%", size: 38, opacity: 0.5, duration: 14, delay: -3, direction: "normal", flap: 0.36, bob: 2.6 },
  { top: "50%", size: 34, opacity: 0.5, duration: 16, delay: -11, direction: "reverse", flap: 0.4, bob: 3.1 },
  { top: "30%", size: 27, opacity: 0.36, duration: 19, delay: -7, direction: "reverse", flap: 0.42, bob: 2.9 },
  { top: "64%", size: 25, opacity: 0.36, duration: 21, delay: -15, direction: "normal", flap: 0.38, bob: 3.4 },
  { top: "6%", size: 19, opacity: 0.22, duration: 24, delay: -5, direction: "normal", flap: 0.46, bob: 3.8 },
  { top: "40%", size: 17, opacity: 0.22, duration: 26, delay: -19, direction: "reverse", flap: 0.5, bob: 3.3 },
  { top: "74%", size: 18, opacity: 0.22, duration: 23, delay: -12, direction: "reverse", flap: 0.44, bob: 4 },
] as const;

/**
 * Chauves-souris qui traversent derrière le contenu en battant des ailes ; le parent doit être
 * positionné et isolé. Chacune enchaîne trois dessins d'ailes, ondule en s'inclinant, et vole sur
 * un plan plus ou moins lointain.
 */
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
              "--bat-size": `${bat.size}px`,
              "--bat-opacity": bat.opacity,
              "--bat-duration": `${bat.duration}s`,
              "--bat-delay": `${bat.delay}s`,
              "--bat-direction": bat.direction,
              "--bat-flap": `${bat.flap}s`,
              "--bat-bob": `${bat.bob}s`,
            } as CSSProperties
          }
        >
          <span className="sdk-bat-body">
            <svg viewBox="0 0 48 25" fill="currentColor">
              {WING_FRAMES.map((wing, frame) => (
                <g key={frame} className={`sdk-bat-frame sdk-bat-frame-${frame}`}>
                  <path d={wing} />
                  <path d={wing} transform="matrix(-1 0 0 1 48 0)" />
                </g>
              ))}
              <path d={BAT_BODY} />
            </svg>
          </span>
        </span>
      ))}
    </div>
  );
}
