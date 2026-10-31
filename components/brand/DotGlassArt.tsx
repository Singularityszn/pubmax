import type { CSSProperties } from "react";

import { glassPoints, type GlassPoint } from "@/lib/dotGlass";

// Two still pictures in the dot style of the Year in Pints glass, for the pages
// a reader meets when something is missing: the 404 shows an EMPTY glass
// ("Called for last orders here"), the error pages a SPILLED one ("Spilled.").
// Both use the same pint outline (lib/dotGlass.ts).
//
// THREE RULES.
//
// (1) DECORATION SAYS NOTHING. The words on the page carry the meaning, so the
//     picture is aria-hidden and draws no text, no number and no motion.
// (2) NO CORAL. Coral is spent on the page's one primary door
//     (docs/DESIGN_SYSTEM.md, "Coral is spent twice"). The few lit dots are
//     the lager-gold --amber, steadied with ink so they read on both papers,
//     and the rest of the glass is muted ink.
// (3) IT RENDERS ANYWHERE. No hooks and no stylesheet, so a server page, a
//     client error boundary and the root global-error document can all draw
//     it. global-error has no tokens, so it passes `fills={null}` and paints
//     the `dotArtDim` and `dotArtLit` classes from its own literal palette.

type Fills = { dim: string; dimOpacity: number; lit: string } | null;

const TOKEN_FILLS: Exclude<Fills, null> = {
  dim: "var(--muted)",
  dimOpacity: 0.32,
  lit: "color-mix(in srgb, var(--amber) 80%, var(--ink))",
};

const SPACING = 8;
const R = SPACING * 0.36;

function Dots({ points, className, style }: { points: GlassPoint[]; className: string; style?: CSSProperties }) {
  return (
    <g className={className} style={style}>
      {points.map((p) => (
        <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r={R} />
      ))}
    </g>
  );
}

function Picture({
  width,
  height,
  dim,
  lit,
  fills,
  className,
}: {
  width: number;
  height: number;
  dim: GlassPoint[];
  lit: GlassPoint[];
  fills: Fills;
  className?: string;
}) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <Dots points={dim} className="dotArtDim" style={fills ? { fill: fills.dim, fillOpacity: fills.dimOpacity } : undefined} />
      <Dots points={lit} className="dotArtLit" style={fills ? { fill: fills.lit } : undefined} />
    </svg>
  );
}

const EMPTY_W = 72;
const EMPTY_H = 112;

/** An empty pint: every dot dim but the bottom row, the dregs. */
export function emptyGlass(): { dim: GlassPoint[]; lit: GlassPoint[] } {
  const points = glassPoints(EMPTY_W, EMPTY_H, SPACING);
  const bottom = points[0]?.y;
  return {
    lit: points.filter((p) => p.y === bottom),
    dim: points.filter((p) => p.y !== bottom),
  };
}

export function EmptyGlassArt({ fills = TOKEN_FILLS, className }: { fills?: Fills; className?: string }) {
  const { dim, lit } = emptyGlass();
  return <Picture width={EMPTY_W} height={EMPTY_H} dim={dim} lit={lit} fills={fills} className={className} />;
}

const SPILL_W = 200;
const SPILL_H = 76;
const GLASS_W = 56;
const GLASS_H = 92;
/** The puddle, row by row from the floor up: how many dots, and how far out it starts. */
const PUDDLE_ROWS: ReadonlyArray<{ dots: number; from: number }> = [
  { dots: 11, from: 0 },
  { dots: 5, from: 0 },
  { dots: 2, from: 0 },
];
/** A few drops that ran further, on the floor, in dots past the rim. */
const DROPS: readonly number[] = [12.5, 14];

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * A pint on its side, rim to the right, and what was in it running out across
 * the floor. The glass is the upright pint turned a quarter, honeycomb and
 * all: its base on the left, its wall resting on the floor. The lowest dot of
 * each column is lit, the last of the pint still inside it.
 */
export function spilledGlass(): { dim: GlassPoint[]; lit: GlassPoint[] } {
  const floor = SPILL_H - SPACING / 2;
  const rowStep = SPACING * (Math.sqrt(3) / 2);
  const quarter = glassPoints(GLASS_W, GLASS_H, SPACING).map((p) => ({ x: GLASS_H - p.y, y: p.x }));
  const drop = floor - Math.max(...quarter.map((p) => p.y));
  const turned = quarter.map((p) => ({ x: round1(p.x), y: round1(p.y + drop) }));
  // Each upright row is now a column; its lowest dot is what is left inside.
  const lowest = new Map<number, number>();
  for (const p of turned) lowest.set(p.x, Math.max(lowest.get(p.x) ?? -Infinity, p.y));
  const inside = turned.filter((p) => lowest.get(p.x) === p.y);
  const glass = turned.filter((p) => lowest.get(p.x) !== p.y);

  const rim = Math.max(...turned.map((p) => p.x)) + SPACING;
  const puddle: GlassPoint[] = [];
  PUDDLE_ROWS.forEach((row, index) => {
    for (let k = 0; k < row.dots; k += 1) {
      puddle.push({ x: round1(rim + (k + row.from + index * 0.5 - 0.5) * SPACING), y: round1(floor - index * rowStep) });
    }
  });
  for (const dx of DROPS) puddle.push({ x: round1(rim + dx * SPACING), y: floor });
  return { dim: glass, lit: [...inside, ...puddle.filter((p) => p.x + R <= SPILL_W)] };
}

export function SpilledGlassArt({ fills = TOKEN_FILLS, className }: { fills?: Fills; className?: string }) {
  const { dim, lit } = spilledGlass();
  return <Picture width={SPILL_W} height={SPILL_H} dim={dim} lit={lit} fills={fills} className={className} />;
}
