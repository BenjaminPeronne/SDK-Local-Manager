import { localDayKey } from "@/lib/seasonal";

const CONFETTI_DAY_KEY = "odoo-manager-confetti-day";
const CONFETTI_COLORS = ["#f2b632", "#f4791f", "#e8a0bf", "#5aa9e6", "#2e9d4f", "#c0c7d1"];
const CONFETTI_COUNT = 140;
const CONFETTI_DURATION_MS = 3200;

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  width: number;
  height: number;
  color: string;
};

/** Faux si les confettis ont déjà été lancés aujourd'hui ; sans stockage, ils restent permis. */
function claimToday() {
  const today = localDayKey(new Date());
  try {
    if (window.localStorage.getItem(CONFETTI_DAY_KEY) === today) return false;
    window.localStorage.setItem(CONFETTI_DAY_KEY, today);
  } catch {
    // Stockage indisponible : une salve de plus vaut mieux qu'une erreur.
  }
  return true;
}

function launchPieces(width: number, height: number) {
  // Vitesse calée sur la hauteur de la fenêtre : la salve monte jusqu'aux deux tiers environ.
  const baseSpeed = Math.sqrt(0.4 * height);
  return Array.from({ length: CONFETTI_COUNT }, (_, index): Piece => {
    // Deux canons, aux coins bas, qui tirent vers le centre.
    const fromLeft = index % 2 === 0;
    const angle = ((fromLeft ? -60 : -120) + (Math.random() - 0.5) * 40) * (Math.PI / 180);
    const speed = baseSpeed * (0.75 + Math.random() * 0.5);
    return {
      x: fromLeft ? 0 : width,
      y: height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      width: 6 + Math.random() * 5,
      height: 3 + Math.random() * 3,
      color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    };
  });
}

/**
 * Salve de confettis par-dessus l'interface, une fois par jour au plus (`everyTime` lève la limite,
 * pour l'aperçu). Rien quand le système demande moins d'animations ; le canevas ne capte aucun clic
 * et disparaît à la fin.
 */
export function celebrateWithConfetti({ everyTime = false } = {}) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!everyTime && !claimToday()) return;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "pointer-events-none fixed inset-0 z-[60]";
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  document.body.appendChild(canvas);
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    return;
  }
  context.scale(ratio, ratio);

  const pieces = launchPieces(width, height);
  let previous = performance.now();
  // Temps d'animation réellement joué : fenêtre en arrière-plan, la salve attend son retour.
  let elapsed = 0;

  const frame = (now: number) => {
    // Pas exprimé en images à 60 par seconde : même trajectoire sur les écrans plus rapides.
    const step = Math.min(3, (now - previous) / (1000 / 60));
    previous = now;
    elapsed += step * (1000 / 60);
    context.clearRect(0, 0, width, height);
    context.globalAlpha = Math.max(0, Math.min(1, (CONFETTI_DURATION_MS - elapsed) / 600));
    for (const piece of pieces) {
      piece.vx *= 0.99 ** step;
      piece.vy = piece.vy * 0.99 ** step + 0.3 * step;
      piece.x += piece.vx * step;
      piece.y += piece.vy * step;
      piece.angle += piece.spin * step;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.color;
      // Largeur oscillante : le confetti semble tourner sur lui-même.
      context.fillRect(-piece.width / 2, -piece.height / 2, piece.width * Math.cos(piece.angle * 2), piece.height);
      context.restore();
    }
    if (elapsed < CONFETTI_DURATION_MS) {
      window.requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  };
  window.requestAnimationFrame(frame);
}
