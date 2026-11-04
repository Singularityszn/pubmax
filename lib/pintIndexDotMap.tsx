// The London Pint Index as a dot picture, for the Index's share cards.
//
// THREE RULES.
//
// (1) EVERY DOT IS A PIECE OF A REAL BOROUGH. The lattice is cut from the 33
//     outlines in data/london_boroughs_simplified.json, the same file the
//     Index classifies its observations with, and a dot exists only where the
//     point-in-polygon test names a borough. Nothing here is decoration shaped
//     like data.
//
// (2) A DOT IS LIT ONLY BY A CITED PRICE. A borough's dots take the band of its
//     league-table average (`buildLeagueTable`), painted by the ONE band rule in
//     lib/priceBand.ts against London's terciles. A borough the Index holds no
//     cited price for stays dim, so an empty edition draws a dim London rather
//     than a guessed one.
//
// (3) THE PICTURE IS COMPUTED, NEVER SHIPPED. The lattice is derived from the
//     outlines on first use and cached for the life of the function, so there
//     is no generated asset to drift from its source. Imported ONLY by
//     `opengraph-image.tsx` route modules, never by a page bundle.

import londonBoroughBoundaries from "@/data/london_boroughs_simplified.json";
import type { BoroughBoundaryCollection } from "@/lib/londonBoroughClassifier";
import { boroughNameForPoint } from "@/lib/londonBoroughPoint.mjs";
import { OG } from "@/lib/ogBrand";
import { buildLeagueTable, type PintIndexSnapshot } from "@/lib/pintIndex";
import { PRICE_BANDS, priceBand, priceBandLabel, type PriceBand } from "@/lib/priceBand";

const BOUNDARIES = londonBoroughBoundaries as BoroughBoundaryCollection;

type DotLatticePoint = { x: number; y: number; borough: string };
export type DotLattice = { width: number; height: number; dots: DotLatticePoint[] };

type Frame = { west: number; east: number; south: number; north: number };

// The frame is the outlines' own extent, read from the file rather than typed.
function boundariesFrame(): Frame {
  const frame = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
  for (const { geometry } of BOUNDARIES.features) {
    const polygons = (
      geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates
    ) as number[][][][];
    for (const rings of polygons) {
      for (const [lng, lat] of rings[0] ?? []) {
        if (lng === undefined || lat === undefined) continue;
        frame.west = Math.min(frame.west, lng);
        frame.east = Math.max(frame.east, lng);
        frame.south = Math.min(frame.south, lat);
        frame.north = Math.max(frame.north, lat);
      }
    }
  }
  return frame;
}

const latticeCache = new Map<string, DotLattice>();

/**
 * A staggered (hexagonal) lattice over London, `width` user units wide, one
 * dot every `spacing` units. The height follows the frame's own aspect,
 * because a latitude degree is longer than a longitude degree this far north.
 */
export function londonDotLattice(width: number, spacing: number): DotLattice {
  const key = `${width}:${spacing}`;
  const cached = latticeCache.get(key);
  if (cached) return cached;

  const frame = boundariesFrame();
  const lonScale = Math.cos((((frame.south + frame.north) / 2) * Math.PI) / 180);
  const height = Math.round(
    (width * (frame.north - frame.south)) / ((frame.east - frame.west) * lonScale),
  );
  const rowStep = spacing * (Math.sqrt(3) / 2);
  const dots: DotLatticePoint[] = [];
  for (let row = 0, y = spacing / 2; y < height; row += 1, y = spacing / 2 + row * rowStep) {
    const offset = row % 2 === 1 ? spacing / 2 : 0;
    for (let x = spacing / 2 + offset; x < width; x += spacing) {
      const lng = frame.west + (x / width) * (frame.east - frame.west);
      const lat = frame.north - (y / height) * (frame.north - frame.south);
      const borough = boroughNameForPoint(lat, lng, BOUNDARIES);
      if (borough) dots.push({ x: round1(x), y: round1(y), borough });
    }
  }
  const lattice = { width, height, dots };
  latticeCache.set(key, lattice);
  return lattice;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Each borough's band, by name, for the boroughs the snapshot holds a cited price for. */
export function boroughBands(snapshot: PintIndexSnapshot | null): Map<string, PriceBand> {
  const bands = new Map<string, PriceBand>();
  if (!snapshot) return bands;
  for (const row of buildLeagueTable(snapshot)) {
    const band = priceBand(row.averageGbp, { city: "london" });
    if (band) bands.set(row.name, band);
  }
  return bands;
}

/** The card's hue for each band: the dark theme's --pint, --amber and --brick. */
export const DOT_BAND_FILL: Record<PriceBand, string> = {
  cheap: OG.pint,
  average: OG.amber,
  expensive: OG.brick,
};

const DIM_FILL = OG.muted;
const DIM_OPACITY = 0.32;

/** The dot picture itself, as an inline SVG satori can draw. */
export function PintIndexDotMap({
  snapshot,
  width = 500,
  spacing = 11,
}: {
  snapshot: PintIndexSnapshot | null;
  width?: number;
  spacing?: number;
}) {
  const lattice = londonDotLattice(width, spacing);
  const bands = boroughBands(snapshot);
  const lit = spacing * 0.36;
  const dim = spacing * 0.2;
  return (
    <svg
      width={lattice.width}
      height={lattice.height}
      viewBox={`0 0 ${lattice.width} ${lattice.height}`}
      fill="none"
    >
      {lattice.dots.map((dot) => {
        const band = bands.get(dot.borough);
        return band ? (
          <circle key={`${dot.x}-${dot.y}`} cx={dot.x} cy={dot.y} r={lit} fill={DOT_BAND_FILL[band]} />
        ) : (
          <circle key={`${dot.x}-${dot.y}`} cx={dot.x} cy={dot.y} r={dim} fill={DIM_FILL} fillOpacity={DIM_OPACITY} />
        );
      })}
    </svg>
  );
}

/** The legend row: the three bands by their words, and what a dim dot means. */
export function PintIndexDotLegend({ fontSize = 20 }: { fontSize?: number }) {
  const swatch = (fill: string, opacity = 1) => (
    <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: fill, opacity, marginRight: 8 }} />
  );
  const item = (fill: string, label: string, opacity?: number) => (
    <div key={label} style={{ display: "flex", alignItems: "center", marginLeft: 22 }}>
      {swatch(fill, opacity)}
      {label}
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", color: OG.muted, fontSize }}>
      {PRICE_BANDS.map((band) => item(DOT_BAND_FILL[band], priceBandLabel(band)))}
      {item(DIM_FILL, "No cited price", 0.6)}
    </div>
  );
}
