import type { ReactNode } from "react";

import { MARK_EMBER, MARK_POLYGONS, MARK_VIEWBOX } from "@/lib/brandMark.mjs";

// This module is the edge-safe part of the OG brand kit. Keep filesystem font
// loading in lib/ogBrand.tsx, which is imported only by Node OG routes.
export const OG_CACHE_HEADERS = {
  "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
} as const;

export function CrossingMark({
  ink,
  size = 46,
}: {
  ink: string;
  size?: number;
}): ReactNode {
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} fill="none">
      <polygon points={MARK_POLYGONS.thinA} fill={ink} />
      <polygon points={MARK_POLYGONS.thinB} fill={ink} />
      <polygon points={MARK_POLYGONS.thick} fill={ink} />
      <circle
        cx={MARK_EMBER.cx}
        cy={MARK_EMBER.cy}
        r={MARK_EMBER.r}
        fill="#ff7a55"
      />
    </svg>
  );
}
