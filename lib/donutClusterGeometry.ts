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

/** The band (0..2) of a cluster's cheapest figure, read off `minPriceKey`
 *  (pence × 10 + band, components/map/canvas/filters.ts), or null when the
 *  cluster says no price or its cheapest pub has no band. */
export function readMinPriceBand(
  props: GeoJSON.GeoJsonProperties,
): 0 | 1 | 2 | null {
  const raw = props?.minPriceKey;
  const n = typeof raw === "number" ? raw : Number(raw ?? Number.NaN);
  if (!Number.isFinite(n) || n < 0) return null;
  const band = Math.round(n) % 10;
  return band === 0 || band === 1 || band === 2 ? band : null;
}

export type DonutMarkerSvgParams = {
  counts: DonutCounts;
  /** The paper the disc is filled with. */
  discColor: string;
  /** The ink hairline round the outside, which edges the disc on any basemap. */
  casingColor: string;
  /** The neutral ring inside the casing. It carries no band. */
  trackColor: string;
  /** Ink for the count and the small words round the figure. */
  textColor: string;
  /** The figure's colour: its own cheapest pub's band ink, or `textColor` when
   *  that pub has no band. The only colour on the disc that means a price. */
  figureColor: string;
  /** The outer radius from {@link donutOuterRadius}. */
  outerRadius: number;
  /** The price the disc prints, already written the pin's way ("£5.40"), or
   *  null to print the count instead. */
  figure: string | null;
  /** Whether "n pubs" fits under this disc. A caller that knows where the
   *  neighbours stand passes false where it would cover one
   *  ({@link placeClusterCaptions}); absent means it fits. */
  countCaption?: boolean;
};

/** The "n pubs" caption's box under a disc centred at `x, y`, in screen px. */
function clusterCaptionBox(
  x: number,
  y: number,
  outerRadius: number,
  total: number,
): [number, number, number, number] {
  const text = `${formatDonutCount(total)} pubs`;
  const width = text.length * 6.2 + 4;
  const top = y + outerRadius + 1;
  return [x - width / 2, top, x + width / 2, top + 14];
}

function overlaps(a: readonly number[], b: readonly number[]): boolean {
  return a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!;
}

/**
 * Which discs may hang "n pubs" under them. A DOM disc joins no collision
 * index, so this is the GL caption's `text-allow-overlap: false` done by hand:
 * a caption that would cover another disc, or a caption already placed, is
 * dropped. The figure is the claim and the count gives way to it. Discs are
 * taken in the order given, so a caller passes the cheaper first.
 */
export function placeClusterCaptions(
  discs: readonly { id: number; x: number; y: number; total: number; priced: boolean }[],
  outerRadius: number,
): Set<number> {
  const discBoxes = discs.map(
    (disc) => [disc.x - outerRadius, disc.y - outerRadius, disc.x + outerRadius, disc.y + outerRadius] as const,
  );
  const placed: (readonly number[])[] = [];
  const shown = new Set<number>();
  discs.forEach((disc, index) => {
    if (!disc.priced) return;
    const box = clusterCaptionBox(disc.x, disc.y, outerRadius, disc.total);
    const hitsDisc = discBoxes.some((other, otherIndex) => otherIndex !== index && overlaps(box, other));
    if (hitsDisc || placed.some((other) => overlaps(box, other))) return;
    placed.push(box);
    shown.add(disc.id);
  });
  return shown;
}

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
/** The "from" over the figure and the "n pubs" under the disc, as a share of
 *  the figure's own size. Small enough that the figure stays the claim. */
export const DONUT_CAPTION_SCALE = 0.62;
/** The figure is set in --font-data (JetBrains Mono) on the donut, where every
 *  glyph advances 600/1000 of an em, and in Noto Sans Bold or Montserrat Medium
 *  on the GL disc, whose glyphs advance no further on average. It keeps this
 *  much paper clear each side. */
const DONUT_FIGURE_ADVANCE_EM = 0.6;
const DONUT_FIGURE_INSET_PX = 1;
/** The longest figure a disc prints: a price ("£12.50") or a count ("1.5k"). */
export const DONUT_FIGURE_MAX_LENGTH = 7;

/** The figure's size for a label this many characters long: 12px on the 44px
 *  disc and 11px on the 36px one, stepped down when a long label ("£12.50")
 *  would otherwise run across the ring. The donut and the GL disc both use it,
 *  so the two draw one figure the same size. */
export function donutFigureFontSize(labelLength: number, outerRadius: number): number {
  const base = outerRadius >= DONUT_OUTER_RADIUS_LARGE ? 12 : 11;
  const paper = 2 * (outerRadius - DONUT_CASING_PX - DONUT_RING_PX - DONUT_FIGURE_INSET_PX);
  const fit = paper / (Math.max(1, labelLength) * DONUT_FIGURE_ADVANCE_EM);
  return Math.min(base, Math.floor(fit * 10) / 10);
}

/** A cluster's spoken label: "from £4.85 · 12 pubs", or "12 pubs" with no price.
 *  The disc draws the same words: "from" over the figure, the count beneath. */
export function clusterLabelText(figure: string | null, total: number): string {
  const pubs = `${formatDonutCount(total)} ${total === 1 ? "pub" : "pubs"}`;
  return figure === null ? pubs : `from ${figure} · ${pubs}`;
}

/** Builds the full marker SVG markup (string in, string out - pure) for a
 *  cluster (owner decision 16 Oct 2026): a NEUTRAL paper disc with an ink
 *  casing and a plain ring that carries no band, "from" over the cheapest price
 *  in that price's own band ink, and "n pubs" under the disc. Where no pub in it
 *  says a price the disc prints its count, in ink, and nothing under it. The
 *  colour on the disc is the figure's band and nothing else, so a cheap figure
 *  can never stand in a dear ring. */
export function buildDonutMarkerSvg(params: DonutMarkerSvgParams): string {
  const total = donutTotal(params.counts);
  const outerRadius = params.outerRadius;
  const ringRadius = outerRadius - DONUT_CASING_PX - DONUT_RING_PX / 2;
  const discRadius = outerRadius - DONUT_CASING_PX;
  const size = outerRadius * 2;
  const label = params.figure ?? formatDonutCount(total);
  const fontSize = donutFigureFontSize(label.length, outerRadius);
  const captionSize = Math.round(fontSize * DONUT_CAPTION_SCALE * 10) / 10;
  // "from" and the figure are set as one block centred on the disc.
  const block = captionSize + 1 + fontSize;
  const figureY = params.figure === null ? outerRadius : outerRadius + block / 2 - fontSize / 2;
  const fromY = outerRadius - block / 2 + captionSize / 2;
  const halo =
    `stroke="${params.discColor}" stroke-width="2" paint-order="stroke" stroke-linejoin="round"`;
  const fromMarkup =
    params.figure === null
      ? ""
      : `<text x="${outerRadius}" y="${fromY.toFixed(2)}" text-anchor="middle" ` +
        `dominant-baseline="central" fill="${params.textColor}" font-size="${captionSize}" ` +
        `font-weight="600" font-family="sans-serif" data-role="from">from</text>`;
  // The count, under the disc in a paper halo so it reads over the map.
  const countMarkup =
    params.figure === null || params.countCaption === false
      ? ""
      : `<text x="${outerRadius}" y="${(size + captionSize * 0.9).toFixed(2)}" text-anchor="middle" ` +
        `dominant-baseline="central" fill="${params.textColor}" font-size="${captionSize + 1}" ` +
        `font-weight="700" ${halo} font-family="sans-serif" data-role="count">` +
        `${formatDonutCount(total)} pubs</text>`;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible" ` +
    `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${clusterLabelText(params.figure, total)}">` +
    `<circle cx="${outerRadius}" cy="${outerRadius}" r="${outerRadius}" fill="${params.casingColor}" />` +
    `<circle cx="${outerRadius}" cy="${outerRadius}" r="${discRadius}" fill="${params.discColor}" />` +
    `<circle cx="${outerRadius}" cy="${outerRadius}" r="${ringRadius}" fill="none" ` +
    `stroke="${params.trackColor}" stroke-width="${DONUT_RING_PX}" data-role="ring" />` +
    fromMarkup +
    `<text x="${outerRadius}" y="${figureY.toFixed(2)}" text-anchor="middle" dominant-baseline="central" ` +
    `fill="${params.figure === null ? params.textColor : params.figureColor}" font-size="${fontSize}" font-weight="700" ` +
    `style="font-family: var(--font-data, ui-monospace, monospace); font-variant-numeric: tabular-nums" ` +
    `data-role="figure">${label}</text>` +
    countMarkup +
    `</svg>`
  );
}
