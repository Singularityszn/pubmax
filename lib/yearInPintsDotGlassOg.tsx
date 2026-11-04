// The Year in Pints glass painted for the share card (satori). The layout is
// lib/yearInPintsDotGlass.ts; this module only gives each tone the card's hue.
// Imported only by app/api/year-card/route.tsx, never by a page.

import { OG } from "@/lib/ogBrand";
import { yearDotGlass, type GlassTone } from "@/lib/yearInPintsDotGlass";

const TONE_FILL: Record<GlassTone, { fill: string; opacity: number }> = {
  night: { fill: OG.amber, opacity: 1 },
  day: { fill: OG.muted, opacity: 0.38 },
  ahead: { fill: OG.muted, opacity: 0.18 },
};

/** The glass as an inline SVG satori can draw. */
export function YearDotGlass(props: { year: number; through: number; nights: number; width?: number; height?: number }) {
  const glass = yearDotGlass(props);
  const r = glass.spacing * 0.36;
  return (
    <svg width={glass.width} height={glass.height} viewBox={`0 0 ${glass.width} ${glass.height}`} fill="none">
      {glass.dots.map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r={r}
          fill={TONE_FILL[dot.tone].fill}
          fillOpacity={TONE_FILL[dot.tone].opacity}
        />
      ))}
    </svg>
  );
}
