import type { CSSProperties } from "react";

/**
 * Serre-tête à oreilles de lapin posé sur le haut d'un logo, l'oreille droite pliée
 * (placement : `.sdk-season-hat-easter`) ; le parent doit être positionné.
 */
export function BunnyEars() {
  return (
    <svg viewBox="0 0 40 34" aria-hidden="true" className="sdk-season-hat sdk-season-hat-easter">
      <path d="M13 29 C7 22 6.5 9 9.5 3.5 C12.5 -0.5 16.5 2 17 8 C17.6 15 17 23 16.5 29 Z" fill="#fff" />
      <path d="M12.6 26 C9.4 20 9.4 10 11 6 C12.6 3.6 14.6 5 14.8 9 C15.2 15 14.8 21 14.6 26 Z" fill="#f6a5c0" />
      <path
        d="M23 29 C23 22 24 14 27 9 C29.5 5 33 4.5 37 6.5 C38.5 7.5 37.5 9.5 35.5 9.5 C32 9.5 30 12 28.5 16 C27.5 20 27.5 25 27.5 29 Z"
        fill="#fff"
      />
      <path
        d="M24.8 26 C25 21 25.8 15 28 11.2 C29.6 8.6 31.6 7.6 34 7.8 C31 9 29 12 27.8 16 C27 19.6 26.8 23 26.8 26 Z"
        fill="#f6a5c0"
      />
      <path d="M4 31 Q20 24 36 31" fill="none" stroke="#f2b632" strokeWidth="3.2" strokeLinecap="round" />
      <g stroke="#000" strokeOpacity="0.12" fill="none">
        <path d="M13 29 C7 22 6.5 9 9.5 3.5 C12.5 -0.5 16.5 2 17 8 C17.6 15 17 23 16.5 29" />
        <path d="M23 29 C23 22 24 14 27 9 C29.5 5 33 4.5 37 6.5 C38.5 7.5 37.5 9.5 35.5 9.5 C32 9.5 30 12 28.5 16 C27.5 20 27.5 25 27.5 29" />
      </g>
    </svg>
  );
}

// Coquille, bande en zigzag et pois : trois couleurs par œuf, tirées d'une petite palette pastel.
const EGG_SHELL =
  "M10 0.8 C15 0.8 19.2 9 19.2 15.6 C19.2 21.4 15.2 25.2 10 25.2 C4.8 25.2 0.8 21.4 0.8 15.6 C0.8 9 5 0.8 10 0.8 Z";
const EGG_BAND =
  "M1.4 12.4 L4.4 10 L7.2 12.4 L10 10 L12.8 12.4 L15.6 10 L18.6 12.4 L19 15.6 L15.6 13.2 L12.8 15.6 L10 13.2 L7.2 15.6 L4.4 13.2 L1 15.6 Z";

const EGG_COLORS = [
  { shell: "#f6a5c0", band: "#fff4c2", dots: "#fff" },
  { shell: "#a8d8f0", band: "#f6a5c0", dots: "#fff4c2" },
  { shell: "#b8e3a2", band: "#fff", dots: "#f6a5c0" },
  { shell: "#f7d77a", band: "#a8d8f0", dots: "#fff" },
  { shell: "#c9b6ec", band: "#b8e3a2", dots: "#fff" },
];

// Positions fixes plutôt qu'aléatoires : même rendu à chaque ouverture et pendant le prérendu. Peu
// d'œufs, et lents : de petites touches, pas une averse.
const EGGS = Array.from({ length: 12 }, (_, index) => {
  const spread = (index * 0.618034 + 0.31) % 1;
  return {
    left: `${(4 + spread * 92).toFixed(1)}%`,
    size: `${13 + (index % 3) * 3}px`,
    duration: `${15 + ((index * 7) % 9)}s`,
    delay: `-${((index * 4.3) % 20).toFixed(1)}s`,
    sway: `${3 + (index % 3)}s`,
    colors: EGG_COLORS[index % EGG_COLORS.length],
  };
});

/**
 * Œufs décorés semés par les cloches de Pâques, qui descendent derrière le contenu en se balançant ;
 * le parent doit être positionné et isolé (`isolate`).
 */
export function EasterEggs() {
  return (
    <div className="sdk-easter-eggs pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {EGGS.map((egg, index) => (
        <span
          key={index}
          className="sdk-egg"
          style={
            {
              left: egg.left,
              "--egg-size": egg.size,
              "--egg-duration": egg.duration,
              "--egg-delay": egg.delay,
              "--egg-sway": egg.sway,
            } as CSSProperties
          }
        >
          <svg viewBox="0 0 20 26" className="sdk-egg-shape">
            <path d={EGG_SHELL} fill={egg.colors.shell} />
            <path d={EGG_BAND} fill={egg.colors.band} />
            <circle cx="6" cy="19.5" r="1.3" fill={egg.colors.dots} />
            <circle cx="10" cy="21" r="1.3" fill={egg.colors.dots} />
            <circle cx="14" cy="19.5" r="1.3" fill={egg.colors.dots} />
            <circle cx="10" cy="6.5" r="1.1" fill={egg.colors.dots} />
            <path d={EGG_SHELL} fill="none" stroke="#000" strokeOpacity="0.1" />
          </svg>
        </span>
      ))}
    </div>
  );
}
