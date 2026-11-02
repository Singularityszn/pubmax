// The dot wordmark's physics, as pure numbers (components/wild/DotFooter.tsx
// draws them). Each dot has a home on the PUBMAXX letters; a finger or a
// pointer pushes the dots near it away, and a spring pulls every dot home.
// No DOM here, so a test can hold the push, the spring and the rest state.

export type WordDot = {
  /** Home, in CSS pixels on the canvas. */
  hx: number;
  hy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** True for a dot on the final X, which takes the brand accent. */
  accent: boolean;
};

/** Spring toward home, per 60 Hz step. */
const DOT_SPRING = 0.055;
/** Velocity kept per 60 Hz step. */
const DOT_DAMPING = 0.84;

/** How far a pointer reaches, from the canvas width: wider canvas, wider hand. */
export function pushRadius(width: number): number {
  return Math.max(34, Math.min(96, width * 0.08));
}

/** The gap between dot centres: about 130 across any width, never tighter than 4px. */
export function dotStep(width: number): number {
  return Math.max(4, Math.round(width / 130));
}

/** The canvas height for a width: a wide band, never taller than it needs to be. */
export function canvasHeight(width: number): number {
  return Math.round(Math.max(84, Math.min(width * 0.25, 320)));
}

/**
 * One 60 Hz step for every dot. `pointer` is null when no finger or pointer is
 * over the canvas; `burst` multiplies the push for the frame a finger lands.
 * Returns the total motion left, so the caller can stop when the word rests.
 */
export function stepDots(
  dots: WordDot[],
  pointer: { x: number; y: number } | null,
  radius: number,
  burst = 1,
): number {
  let motion = 0;
  const reach = radius * radius;
  for (const dot of dots) {
    if (pointer) {
      const dx = dot.x - pointer.x;
      const dy = dot.y - pointer.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < reach) {
        const dist = Math.sqrt(dist2) || 1;
        const force = (1 - dist / radius) * 4.2 * burst;
        dot.vx += (dx / dist) * force;
        dot.vy += (dy / dist) * force;
      }
    }
    dot.vx = (dot.vx + (dot.hx - dot.x) * DOT_SPRING) * DOT_DAMPING;
    dot.vy = (dot.vy + (dot.hy - dot.y) * DOT_SPRING) * DOT_DAMPING;
    dot.x += dot.vx;
    dot.y += dot.vy;
    motion += Math.abs(dot.vx) + Math.abs(dot.vy) + Math.abs(dot.hx - dot.x) + Math.abs(dot.hy - dot.y);
  }
  return motion;
}

/** Puts every dot home and still: the word at rest. */
export function settleDots(dots: WordDot[]): void {
  for (const dot of dots) {
    dot.x = dot.hx;
    dot.y = dot.hy;
    dot.vx = 0;
    dot.vy = 0;
  }
}

/** True when the word is close enough to rest to stop drawing. */
export function dotsAtRest(motion: number, count: number): boolean {
  return count === 0 || motion / count < 0.02;
}

/**
 * Throws the dots out from where they rest, so the word gathers itself the
 * first time it comes into view. Deterministic, so a test can hold it.
 */
export function scatterDots(dots: WordDot[], width: number, height: number): void {
  let seed = 11;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (const dot of dots) {
    dot.x = dot.hx + (next() - 0.5) * width * 0.5;
    dot.y = dot.hy + (next() - 0.5) * height * 1.6;
    dot.vx = 0;
    dot.vy = 0;
  }
}
