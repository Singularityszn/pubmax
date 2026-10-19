// The pint price needle (VenuePintNeedle.tsx), as pure arithmetic: where on a
// half-dial a pub's pint points. The dial is the city's own three price
// bands, as equal arcs, cut at the two prices lib/priceBand.ts holds. So the
// needle points into the same band the pub's pin is painted, and this file
// keeps no copy of the price rules: it reads the thresholds it is given.

import type { PriceBandThresholds } from "@/lib/priceBand";

/** The needle never lies flat on the dial's ends, so it always reads. */
const END_MARGIN = 0.03;

/**
 * Where along the dial (0 at the cheap end, 1 at the dear end) a pint of
 * `priceGbp` points. Each band takes a third. Inside the middle band the
 * figure sits in proportion between the two cut prices; the outer bands run
 * one middle band's width beyond them, and a price past that pins to the end.
 */
export function pintNeedlePosition(priceGbp: number, thresholds: PriceBandThresholds): number {
  const { cheapMaxGbp, averageMaxGbp } = thresholds;
  const span = Math.max(0.3, averageMaxGbp - cheapMaxGbp);
  let position: number;
  if (priceGbp <= cheapMaxGbp) {
    position = (1 / 3) * (1 - (cheapMaxGbp - priceGbp) / span);
  } else if (priceGbp <= averageMaxGbp) {
    position = 1 / 3 + (1 / 3) * ((priceGbp - cheapMaxGbp) / span);
  } else {
    position = 2 / 3 + (1 / 3) * ((priceGbp - averageMaxGbp) / span);
  }
  return Math.min(1 - END_MARGIN, Math.max(END_MARGIN, position));
}

/** The needle's angle in degrees: -90 points at the cheap end, 90 at the dear end. */
export function pintNeedleAngle(position: number): number {
  return -90 + 180 * position;
}

/** A point on the dial's arc, `position` along it, for a dial centred at cx, cy. */
export function pintNeedlePoint(position: number, cx: number, cy: number, radius: number): { x: number; y: number } {
  const radians = (pintNeedleAngle(position) * Math.PI) / 180;
  return { x: cx + Math.sin(radians) * radius, y: cy - Math.cos(radians) * radius };
}

/** The SVG arc for one band's third of the dial. */
export function pintNeedleArc(band: 0 | 1 | 2, cx: number, cy: number, radius: number): string {
  const gap = 0.012;
  const start = pintNeedlePoint(band / 3 + (band === 0 ? 0 : gap), cx, cy, radius);
  const end = pintNeedlePoint((band + 1) / 3 - (band === 2 ? 0 : gap), cx, cy, radius);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}
