import "./pubmaxxMark.css";

// ── PUBMAXX mark: "The Crossing X" ────────────────────────────────────────────
// A blackboard-bold / double-struck X, built on the X Corp construction: one
// THICK solid descending stroke (\, top-left → bottom-right) and an ascending
// stroke (/, bottom-left → top-right) SPLIT INTO TWO thin parallel strokes that
// pass either side of the thick one, leaving a clear channel where they cross.
// Flat sharp terminals, zero ornament — a confident, distinctly PUBMAXX X that
// survives down to a 16px favicon (where it falls back to the simplified single
// ascending stroke, `slashSimple`, since the double-stroke channel closes up).
//
// Geometry lives on a 64×64 grid and is the single source of truth shared with
// scripts/gen-brand-assets.mjs and scripts/gen-native-app-icons.mjs (which stamp
// the static favicon / PWA / apple / native assets from the same numbers). If
// you change a coordinate here, re-run those generators so the exported assets
// stay identical. The strokes are filled polygons, not stroked paths, so the
// flat-cut terminals stay crisp at every raster tier.

export const MARK_GEOMETRY = {
  viewBox: "0 0 64 64",
  // The thick descending stroke (\), ~12u wide, drawn on top of the two thin
  // ascending strokes so the crossing reads as a clean interlock. `points`
  // feeds an SVG <polygon> directly.
  thick: "9,10 21,10 55,54 43,54",
  // The ascending stroke (/) split into two thin (~5u) parallel strokes that
  // pass either side of the thick one, with a ~4u channel between them where
  // the thick stroke crosses — the double-struck construction. thinA is the
  // upper-left stroke, thinB the lower-right.
  thinA: "42,10 47,10 13,54 8,54",
  thinB: "51,10 56,10 22,54 17,54",
  // Simplified single ascending stroke (~8u) for the smallest raster tier
  // (the 16px favicon.ico entry): at 16px the double-stroke channel closes up,
  // so the icon falls back to a single clean forward slash + the thick stroke.
  slashSimple: "45,10 53,10 19,54 11,54",
  // The ember: a lit spark at the crossing. It is NOT part of the icon
  // silhouette — the static favicon / PWA / app-icon exports drop it (the
  // double-struck crossing is already the event, and a dot muddies it). It is
  // kept only on the lit in-app brand surfaces (duo / plaque variants, the
  // Strike pop, the night seal, the loading ember) as a personality touch.
  node: { cx: 32, cy: 32, r: 3.2 },
  // Full-bleed tile radius for the standalone/plaque variant.
  plaqueRadius: 15,
} as const;

// Token colours with literal fallbacks so the mark also renders correctly
// outside the app's CSS (Storybook, emails, satori is handled separately in
// lib/ogBrand.tsx). Inside the app these resolve to the live theme tokens.
// Exported so the Strike animation family (PubmaxxMarkStrike) can single-source
// the same palette without re-declaring the tokens — a drift here would ship a
// mark whose animated draw finishes in a different colour than the static rest.
export const MARK_COLORS = {
  coral: "var(--brass, #ff5a5f)",
  bright: "var(--brass-bright, #ff7a55)",
  inkDeep: "var(--ink-deep, #060607)",
} as const;

const COL = MARK_COLORS;

export type PubmaxxMarkVariant = "mono" | "duo" | "plaque";

export interface PubmaxxMarkProps {
  /** Rendered pixel size (width & height). Default 28. */
  size?: number;
  /**
   * mono   — single-colour X in `currentColor`; inherits theme ink. Default.
   * duo    — coral X with a lit coral-bright ember at the crossing, transparent bg.
   * plaque — ink-deep rounded-square tile with the coral X + ember on it.
   */
  variant?: PubmaxxMarkVariant;
  /**
   * Accessible name. When provided the SVG is exposed as an image with this
   * label; when omitted the mark is decorative (aria-hidden) — pair it with
   * adjacent text (e.g. the wordmark) that already names the brand.
   */
  title?: string;
  className?: string;
}

const g = MARK_GEOMETRY;

export default function PubmaxxMark({
  size = 28,
  variant = "mono",
  title,
  className = "",
}: PubmaxxMarkProps) {
  const labelled = Boolean(title);
  // Strokes are coral on the duo/plaque variants and inherit ink via
  // currentColor on mono. The plaque lays them on an ink-deep tile; duo/mono
  // are transparent.
  const armFill = variant === "mono" ? "currentColor" : COL.coral;
  const showTile = variant === "plaque";
  const showNode = variant !== "mono";

  return (
    <svg
      className={`pubmaxxMark ${className}`.trim()}
      width={size}
      height={size}
      viewBox={g.viewBox}
      fill="none"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {showTile ? (
        <rect width="64" height="64" rx={g.plaqueRadius} fill={COL.inkDeep} />
      ) : null}
      {/* Two thin ascending strokes first, then the thick descending stroke on
          top — the double-struck crossing. */}
      <polygon points={g.thinA} fill={armFill} />
      <polygon points={g.thinB} fill={armFill} />
      <polygon points={g.thick} fill={armFill} />
      {showNode ? <circle cx={g.node.cx} cy={g.node.cy} r={g.node.r} fill={COL.bright} /> : null}
    </svg>
  );
}
