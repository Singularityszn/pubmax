// The Price Glass's geometry and motion, as pure numbers (components/wild/
// PriceGlass.tsx draws them). Every figure is in the glass SVG's own units
// (viewBox 0 0 220 440), so a phone and a desktop pour the same pint at two
// sizes. No React and no DOM here, so a test can hold each curve.

/** The glass's inner rim, where a full glass reaches. */
export const GLASS_RIM_Y = 40;
/** The inside of the glass's floor, where an empty glass sits. */
export const GLASS_FLOOR_Y = 404;
/** The SVG's height: the floor, then the thick base under it. */
export const GLASS_VIEW_H = 440;
export const GLASS_VIEW_W = 220;
/** Head room above a full glass, so the foam never spills over the rim. */
const HEADROOM = 6;

/** The nonic pint: straight sides, the bulge under the rim, a rounded foot. */
export const GLASS_INNER_PATH =
  "M38 40 L182 40 L176 150 Q187 180 172 220 L160 392 Q158 404 146 404 L74 404 Q62 404 60 392 L48 220 Q33 180 44 150 Z";
/** The heavy base a real pint glass stands on. */
export const GLASS_BASE_PATH =
  "M60 396 Q62 406 74 406 L146 406 Q158 406 160 396 L157 424 Q155 432 146 432 L74 432 Q65 432 63 424 Z";

/**
 * Where a price sits on the glass: £0 on the floor, the scale's top just under
 * the rim. A price over the scale fills the glass and no further; the figure
 * beside it still prints the real price.
 */
export function glassLevelY(priceGbp: number, scaleMaxGbp: number): number {
  const share = scaleMaxGbp > 0 ? Math.min(1, Math.max(0, priceGbp / scaleMaxGbp)) : 0;
  return GLASS_FLOOR_Y - share * (GLASS_FLOOR_Y - GLASS_RIM_Y - HEADROOM);
}

/** The same place as a share of the SVG's height, for an HTML label beside it. */
export function glassLevelShare(priceGbp: number, scaleMaxGbp: number): number {
  return glassLevelY(priceGbp, scaleMaxGbp) / GLASS_VIEW_H;
}

/** A long pour takes longer than a top-up, and none is slow. */
export function pourDurationMs(fromGbp: number, toGbp: number, scaleMaxGbp: number): number {
  const share = scaleMaxGbp > 0 ? Math.min(1, Math.abs(toGbp - fromGbp) / scaleMaxGbp) : 0;
  return Math.round(620 + share * 900);
}

/** Fast out of the tap, slowing as the glass fills: the figure lands, never overshoots. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** How hard the surface rocks after a change: a bigger change rocks harder. */
export function sloshAmplitude(fromGbp: number, toGbp: number, scaleMaxGbp: number): number {
  const share = scaleMaxGbp > 0 ? Math.abs(toGbp - fromGbp) / scaleMaxGbp : 0;
  return Math.min(13, 4 + share * 22);
}

/**
 * The surface's tilt at one moment: a damped swing, so the beer rocks, then
 * settles flat. Units are the rise of the left edge over the centre.
 */
export function sloshTilt(amplitude: number, elapsedMs: number): number {
  if (elapsedMs < 0) return 0;
  return amplitude * Math.exp(-elapsedMs / 520) * Math.sin((2 * Math.PI * elapsedMs) / 560);
}

/** The head while pouring is tall and loose; a settled head is a finger. */
export const FOAM_POURING = 24;
export const FOAM_SETTLED = 13;
export const FOAM_DRAINED = 8;

/** One step of the head easing toward its target, frame-rate independent. */
export function foamStep(current: number, target: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return target;
  return target + (current - target) * Math.exp(-Math.max(0, dtMs) / tauMs);
}

const FOAM_HUMPS = 9;

/**
 * The head of foam: a lumpy top edge that rocks with the surface, and a flat
 * underside. `top` is the surface at the centre, `height` the head's depth,
 * `tilt` the left edge's rise, `phase` the slow drift of the lumps.
 */
export function foamPathD(top: number, height: number, tilt: number, phase: number): string {
  const left = 0;
  const right = GLASS_VIEW_W;
  const span = right - left;
  const at = (x: number) => top - tilt + (2 * tilt * (x - left)) / span;
  const step = span / FOAM_HUMPS;
  let d = `M${left} ${(at(left) + height).toFixed(2)} L${left} ${at(left).toFixed(2)}`;
  for (let i = 0; i < FOAM_HUMPS; i += 1) {
    const x0 = left + i * step;
    const x1 = x0 + step;
    const lift = 2.4 + 1.6 * Math.sin(i * 1.7 + phase);
    const cx = x0 + step / 2;
    d += ` Q${cx.toFixed(2)} ${(at(cx) - lift).toFixed(2)} ${x1.toFixed(2)} ${at(x1).toFixed(2)}`;
  }
  d += ` L${right} ${(at(right) + height).toFixed(2)} Z`;
  return d;
}

/** One rising bubble's fixed character, drawn once per glass. */
export type GlassBubble = { x: number; r: number; speed: number; offset: number; sway: number };

/** A deterministic fizz, so two renders of one glass draw the same bubbles. */
export function makeBubbles(count: number): GlassBubble[] {
  const out: GlassBubble[] = [];
  let seed = 7;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i += 1) {
    out.push({
      x: 66 + next() * 88,
      r: 0.9 + next() * 1.6,
      speed: 0.018 + next() * 0.03,
      offset: next() * 400,
      sway: next() * Math.PI * 2,
    });
  }
  return out;
}

/** Where a bubble is now: rising from the floor, wrapping at the beer's surface. */
export function bubbleY(bubble: GlassBubble, nowMs: number, surfaceY: number): number | null {
  const span = GLASS_FLOOR_Y - 4 - surfaceY;
  if (span < 14) return null;
  return GLASS_FLOOR_Y - 4 - ((nowMs * bubble.speed + bubble.offset) % span);
}
