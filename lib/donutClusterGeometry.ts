// M5 — pure donut-cluster geometry/segment math. No DOM, no MapLibre types:
// every function here takes plain numbers/strings and returns plain
// numbers/strings, so it is unit-testable without a browser or a map
// instance. The marker-sync module (components/map/canvas/donutClusters.ts)
// is the only caller; it owns the DOM/MapLibre wiring.

/** Price-band bucket order: ≤£5.50, >£5.50–≤£7, >£7, no price (matches
 *  priceBucket() in components/map/canvas/geojson.ts and the legend in
 *  MapKey.tsx: green / amber / red / muted). */
export type DonutCounts = readonly [number, number, number, number];

/** The two disc sizes, as OUTER radii (casing included): a 44px disc up to the
 *  last whole zoom the source clusters below the street band and a 36px one from
 *  DONUT_SMALL_FROM_ZOOM on, where the discs thin out. The GL `clusters` layer
 *  (components/map/canvas/buildScene.ts) draws the same two, so a donut is the
 *  size of the disc it replaces at every zoom. A disc no longer grows with its
 *  count: the count is the small number on its rim and the figure is the price. */
export const DONUT_OUTER_RADIUS_LARGE = 22;
export const DONUT_OUTER_RADIUS_SMALL = 18;
export const DONUT_SMALL_FROM_ZOOM = 13;

export function donutOuterRadius(zoom: number): number {
  return zoom >= DONUT_SMALL_FROM_ZOOM ? DONUT_OUTER_RADIUS_SMALL : DONUT_OUTER_RADIUS_LARGE;
}

/** The cheapest price a cluster's pubs say, or null when none of them does.
 *  `minPrice` is supercluster's own `min` over the pubs' `clusterPrice`, which
 *  a pub that says nothing leaves at 9999 (filters.ts, CLUSTER_PRICE_NONE). */
export function readMinPrice(
  props: GeoJSON.GeoJsonProperties,
  none = 9999,
): number | null {
  const raw = props?.minPrice;
  const n = typeof raw === "number" ? raw : Number(raw ?? none);
  return Number.isFinite(n) && n > 0 && n < none ? n : null;
}

export type DonutStrokeSegment = {
  index: number;
  count: number;
  color: string;
  /** SVG `stroke-dasharray` value: "<arc length> <remaining circumference>". */
  dasharray: string;
  /** SVG `stroke-dashoffset` value (negative — segments are laid end to end,
   *  starting from 12 o'clock via the caller's -90deg group rotation). */
  dashoffset: number;
};

/** Builds concentric-circle stroke segments (dasharray/dashoffset), one per
 *  non-zero bucket, proportional to its share of the total. This is the
 *  standard "circle as pie/donut" SVG technique — far simpler and more
 *  robust than hand-rolled arc `path d=` math (no edge cases for a segment
 *  that spans a full circle). Buckets with a zero count are omitted so the
 *  DOM/paint stays proportional to what is actually drawn. */
export function buildDonutStrokeSegments(
  counts: DonutCounts,
  colors: readonly string[],
  radius: number,
): DonutStrokeSegment[] {
  const total = counts.reduce((sum, n) => sum + Math.max(0, n), 0);
  if (total <= 0 || radius <= 0) return [];
  const circumference = 2 * Math.PI * radius;
  const segments: DonutStrokeSegment[] = [];
  let cumulative = 0;
  counts.forEach((count, index) => {
    if (count <= 0) return;
    const arcLength = (count / total) * circumference;
    segments.push({
      index,
      count,
      color: colors[index] ?? "#888888",
      dasharray: `${arcLength.toFixed(3)} ${(circumference - arcLength).toFixed(3)}`,
      dashoffset: -cumulative,
    });
    cumulative += arcLength;
  });
  return segments;
}

export type DonutMarkerSvgParams = {
  counts: DonutCounts;
  /** Colors indexed the same way as `counts` (bucket 0..3). */
  colors: readonly string[];
  /** The paper the disc is filled with. */
  discColor: string;
  /** The ink hairline round the outside, which edges the disc on any basemap. */
  casingColor: string;
  /** Track ring color (drawn under the segments at low opacity). */
  trackColor: string;
  /** The figure's color. */
  textColor: string;
  /** The outer radius from {@link donutOuterRadius}. */
  outerRadius: number;
  /** The price the disc prints, already written the pin's way ("£5.40"), or
   *  null to print the count instead. */
  figure: string | null;
};

/** Total across all buckets — the number rendered in the donut's hole. */
export function donutTotal(counts: DonutCounts): number {
  return counts.reduce((sum, n) => sum + Math.max(0, n), 0);
}

/** Matches supercluster's `getClusterProperties` abbreviation exactly (the
 *  same formatting MapLibre's `point_count_abbreviated` property carries for
 *  the legacy `cluster-count` text layer — see
 *  node_modules/maplibre-gl/dist/maplibre-gl-dev.js), so a cluster's label
 *  reads identically whether it's rendered as a donut marker or (past
 *  DONUT_CAP) the plain circle+count GL layers it hands off to:
 *  count >= 10000 → round to the nearest 1000, e.g. 12345 -> "12k"
 *  count >= 1000   → round to one decimal of a thousand, e.g. 1500 -> "1.5k"
 *  otherwise       → the exact count. */
export function formatDonutCount(total: number): string {
  if (total >= 10000) return `${Math.round(total / 1000)}k`;
  if (total >= 1000) return `${Math.round(total / 100) / 10}k`;
  return String(total);
}

/** The hairline of ink round the outside of a disc, in px (buildScene's
 *  CLUSTER_CASING_PX) and the width of the band ring inside it (CLUSTER_RING_PX). */
export const DONUT_CASING_PX = 1.25;
export const DONUT_RING_PX = 3;
/** Fewer pubs than this and the disc wears no count on its rim. */
export const DONUT_BADGE_MIN = 10;
/** The figure is set in --font-data (JetBrains Mono), where every glyph
 *  advances 600/1000 of an em, and it keeps this much paper clear each side. */
const DONUT_FIGURE_ADVANCE_EM = 0.6;
const DONUT_FIGURE_INSET_PX = 1;

/** The figure's size: 12px on the 44px disc and 11px on the 36px one, stepped
 *  down when a long label ("£12.50") would otherwise run across the ring. */
function donutFigureFontSize(label: string, outerRadius: number): number {
  const base = outerRadius >= DONUT_OUTER_RADIUS_LARGE ? 12 : 11;
  const paper = 2 * (outerRadius - DONUT_CASING_PX - DONUT_RING_PX - DONUT_FIGURE_INSET_PX);
  const fit = paper / (label.length * DONUT_FIGURE_ADVANCE_EM);
  return Math.min(base, Math.floor(fit * 10) / 10);
}

/** Builds the full marker SVG markup (string in, string out - pure) for a
 *  cluster: a paper disc with an ink casing, the price-band mix as a 3px ring,
 *  the cheapest price in the middle (the count where there is none) and, from
 *  ten pubs up, the count on the rim at the upper right. The ring is a hint and
 *  the figure is the claim, so a band is never a fill. */
export function buildDonutMarkerSvg(params: DonutMarkerSvgParams): string {
  const total = donutTotal(params.counts);
  const outerRadius = params.outerRadius;
  const ringRadius = outerRadius - DONUT_CASING_PX - DONUT_RING_PX / 2;
  const discRadius = outerRadius - DONUT_CASING_PX;
  const size = outerRadius * 2;
  const segments = buildDonutStrokeSegments(params.counts, params.colors, ringRadius);
  const label = params.figure ?? formatDonutCount(total);
  const fontSize = donutFigureFontSize(label, outerRadius);
  const badge =
    params.figure !== null && total >= DONUT_BADGE_MIN ? formatDonutCount(total) : null;
  const segmentMarkup = segments
    .map(
      (seg) =>
        `<circle cx="${outerRadius}" cy="${outerRadius}" r="${ringRadius}" fill="none" ` +
        `stroke="${seg.color}" stroke-width="${DONUT_RING_PX}" ` +
        `stroke-dasharray="${seg.dasharray}" stroke-dashoffset="${seg.dashoffset}" ` +
        `stroke-linecap="butt" data-bucket="${seg.index}" />`,
    )
    .join("");
  // The count on the rim sits on the ring at 45 degrees, in a paper halo so it
  // reads over the ring and the map alike. It overhangs the disc a little, so
  // the SVG's box is the disc's and its overflow is visible.
  const badgeOffset = ringRadius * Math.SQRT1_2;
  const badgeMarkup =
    badge === null
      ? ""
      : `<text x="${(outerRadius + badgeOffset).toFixed(2)}" y="${(outerRadius - badgeOffset).toFixed(2)}" ` +
        `text-anchor="middle" dominant-baseline="central" fill="${params.textColor}" ` +
        `font-size="10" font-weight="700" stroke="${params.discColor}" stroke-width="2" ` +
        `paint-order="stroke" stroke-linejoin="round" font-family="sans-serif" ` +
        `data-role="count">${badge}</text>`;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible" ` +
    `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${total} pubs">` +
    `<circle cx="${outerRadius}" cy="${outerRadius}" r="${outerRadius}" fill="${params.casingColor}" />` +
    `<circle cx="${outerRadius}" cy="${outerRadius}" r="${discRadius}" fill="${params.discColor}" />` +
    `<circle cx="${outerRadius}" cy="${outerRadius}" r="${ringRadius}" fill="none" ` +
    `stroke="${params.trackColor}" stroke-width="${DONUT_RING_PX}" opacity="0.28" />` +
    `<g transform="rotate(-90 ${outerRadius} ${outerRadius})">${segmentMarkup}</g>` +
    `<text x="${outerRadius}" y="${outerRadius}" text-anchor="middle" dominant-baseline="central" ` +
    `fill="${params.textColor}" font-size="${fontSize}" font-weight="700" ` +
    `style="font-family: var(--font-data, ui-monospace, monospace); font-variant-numeric: tabular-nums" ` +
    `data-role="figure">${label}</text>` +
    badgeMarkup +
    `</svg>`
  );
}
