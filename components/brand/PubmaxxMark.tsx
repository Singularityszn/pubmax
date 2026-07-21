import "./pubmaxxMark.css";

// ── PUBMAXX mark: "The Clink" ─────────────────────────────────────────────────
// The X is two pints the second they touch in a toast, the moment a night
// officially starts. Each arm is a tapered pint glass (wide mouth up, narrow
// base down); the ember dot at the contact point is the clink itself. At size
// the taper reads as glasses; at 16px it collapses to a confident chiselled X.
// It keeps the current mark's ember, so the brand evolves rather than reboots.
//
// Geometry lives on a 64×64 grid and is the single source of truth shared with
// scripts/gen-brand-assets.mjs and scripts/gen-native-app-icons.mjs (which stamp
// the static favicon / PWA / apple / native assets from the same numbers). If
// you change a coordinate here, re-run those generators so the exported assets
// stay identical. The arms are filled polygons, not strokes, so the flat-cut
// chiselled terminals stay crisp at every raster tier.

export const MARK_GEOMETRY = {
  viewBox: "0 0 64 64",
  // Two tapered arms, symmetric about centre (32,32). `points` strings feed an
  // SVG <polygon> directly. Arm A runs top-left → bottom-right, arm B mirrors it.
  armA: "19.8,8.7 10.2,17.3 46.0,53.7 52.0,48.3",
  armB: "44.2,8.7 53.8,17.3 18.0,53.7 12.0,48.3",
  // The ember: the clink. Drops out at raster tiers ≤24px (the small-optics
  // rule, #444 precedent) — a rule the raster generators apply; the live vector
  // component keeps the node on the duo/plaque variants at every size.
  node: { cx: 32, cy: 32, r: 3.2 },
  // Full-bleed tile radius for the standalone/plaque variant.
  plaqueRadius: 15,
} as const;

// Token colours with literal fallbacks so the mark also renders correctly
// outside the app's CSS (Storybook, emails, satori is handled separately in
// lib/ogBrand.tsx). Inside the app these resolve to the live theme tokens.
const COL = {
  coral: "var(--brass, #ff5a5f)",
  bright: "var(--brass-bright, #ff7a55)",
  inkDeep: "var(--ink-deep, #060607)",
} as const;

export type PubmaxxMarkVariant = "mono" | "duo" | "plaque";

export interface PubmaxxMarkProps {
  /** Rendered pixel size (width & height). Default 28. */
  size?: number;
  /**
   * mono   — single-colour Clink in `currentColor`; inherits theme ink. Default.
   * duo    — coral Clink with a lit coral-bright ember node, transparent bg.
   * plaque — ink-deep rounded-square tile with the coral Clink + ember on it.
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
  // Arms are coral on the duo/plaque variants and inherit ink via currentColor
  // on mono. The plaque lays them on an ink-deep tile; duo/mono are transparent.
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
      <polygon points={g.armA} fill={armFill} />
      <polygon points={g.armB} fill={armFill} />
      {showNode ? <circle cx={g.node.cx} cy={g.node.cy} r={g.node.r} fill={COL.bright} /> : null}
    </svg>
  );
}
