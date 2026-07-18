import "./pubmaxxMark.css";

// ── PUBMAXX mark: "The Crossing" ──────────────────────────────────────────────
// A single bold X — "× marks the pub" / two routes meeting at a lit rendezvous
// node. It is the mark half of the identity; the wordmark carries the doubled
// ×× (PUBMA××ING). One X reads cleanly down to a 16px favicon where a pair
// would smear, and it is the most ownable, least kitsch reduction of the brand
// (no beer mugs, no foam).
//
// Geometry lives on a 64×64 grid and is the single source of truth shared with
// scripts/gen-brand-assets.mjs (which stamps the static favicon / PWA / apple
// assets from the same numbers). If you change a coordinate here, re-run
// `node scripts/gen-brand-assets.mjs` so the exported assets stay identical.

export const MARK_GEOMETRY = {
  viewBox: "0 0 64 64",
  stroke: 8.5,
  // Two arms of the crossing, symmetric about centre (32,32).
  armA: { x1: 18.5, y1: 18.5, x2: 45.5, y2: 45.5 },
  armB: { x1: 45.5, y1: 18.5, x2: 18.5, y2: 45.5 },
  node: { cx: 32, cy: 32, r: 3.2 },
  plaqueRadius: 15,
} as const;

// Token colours with literal fallbacks so the mark also renders correctly
// outside the app's CSS (Storybook, emails, satori is handled separately in
// lib/ogBrand.tsx). Inside the app these resolve to the live theme tokens.
const COL = {
  coral: "var(--brass, #ff5a5f)",
  amber: "var(--amber, #f0a01a)",
  bright: "var(--brass-bright, #ff7a55)",
  inkDeep: "var(--ink-deep, #060607)",
} as const;

export type PubmaxxMarkVariant = "mono" | "duo" | "plaque";

export interface PubmaxxMarkProps {
  /** Rendered pixel size (width & height). Default 28. */
  size?: number;
  /**
   * mono   — single-colour X in `currentColor`; inherits theme ink. Default.
   * duo    — coral + amber crossing with a lit coral-bright node, transparent bg.
   * plaque — coral rounded-square chip with an ink-deep X knocked across it.
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
  const strokeColorA = variant === "mono" ? "currentColor" : variant === "plaque" ? COL.inkDeep : COL.coral;
  const strokeColorB = variant === "mono" ? "currentColor" : variant === "plaque" ? COL.inkDeep : COL.amber;
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
      {variant === "plaque" ? (
        <rect width="64" height="64" rx={g.plaqueRadius} fill={COL.coral} />
      ) : null}
      <path
        d={`M${g.armA.x1} ${g.armA.y1} L${g.armA.x2} ${g.armA.y2}`}
        stroke={strokeColorA}
        strokeWidth={g.stroke}
        strokeLinecap="round"
      />
      <path
        d={`M${g.armB.x1} ${g.armB.y1} L${g.armB.x2} ${g.armB.y2}`}
        stroke={strokeColorB}
        strokeWidth={g.stroke}
        strokeLinecap="round"
      />
      {showNode ? <circle cx={g.node.cx} cy={g.node.cy} r={g.node.r} fill={COL.bright} /> : null}
    </svg>
  );
}
