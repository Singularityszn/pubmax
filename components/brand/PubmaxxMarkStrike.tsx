import { useId } from "react";

import "./pubmaxxMarkStrike.css";
import { MARK_COLORS, MARK_GEOMETRY, type PubmaxxMarkProps } from "./PubmaxxMark";

// ── The Strike ────────────────────────────────────────────────────────────────
// The signature draw-in of the Clink. The heavy first beam is struck over ~180ms,
// the second beam starts overlapping (~120ms in) and lands over ~140ms, then the
// ember pops at the clink moment (scale 0 → 1.15 → 1.0 over 160ms). Total ~420ms.
//
// Containment (fontPartyContainment-style discipline): the Strike animation lives
// in THIS component family only — PubmaxxMarkStrike.tsx + pubmaxxMarkStrike.css.
// It reuses PubmaxxMark's single geometry source (MARK_GEOMETRY) and palette
// (MARK_COLORS) so the drawn mark is byte-identical to the static one; it does
// NOT touch PubmaxxMark's API. Reduced motion is honoured purely in CSS (a single
// 120ms opacity fade, ember static) so the component stays a pure render — no
// matchMedia, testable via renderToStaticMarkup.
//
// The draw is a stroke-dashoffset wipe on an SVG <mask>: a thick white beam is
// stroked down each arm's centreline and its dash is retracted to reveal the
// filled arm polygon from mouth to base. Only stroke-dashoffset (the draw) and
// transform/opacity (the ember pop + fade) animate — no layout, no paint churn.

export interface PubmaxxMarkStrikeProps extends PubmaxxMarkProps {
  /**
   * Freeze at the final drawn state without replaying the strike (e.g. a seal
   * already collected on a profile). The mark renders fully struck, ember lit,
   * no motion. Default false — the strike plays on first reveal (mount).
   */
  still?: boolean;
  /**
   * Force the ember node on and in `currentColor` even on the `mono` variant.
   * Used by the monochrome night seal so the clink still pops in one ink/coral
   * tone. Default false — `mono` stays ember-less exactly like PubmaxxMark.
   */
  monoEmber?: boolean;
}

const g = MARK_GEOMETRY;

// Beam centrelines: mouth (top) → base (bottom), extended a touch past both ends
// so the round stroke cap fully covers each arm's flat-cut terminal. The wipe
// runs from the path start (the mouth), so each arm draws mouth-first.
const BEAM_A = "M13,10.8 L51,53.2"; // heavy first beam (top-left mouth → bottom-right base)
const BEAM_B = "M51,10.8 L13,53.2"; // second beam, mirrored

export default function PubmaxxMarkStrike({
  size = 28,
  variant = "duo",
  title,
  className = "",
  still = false,
  monoEmber = false,
}: PubmaxxMarkStrikeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const maskA = `strikeBeamA-${uid}`;
  const maskB = `strikeBeamB-${uid}`;

  const labelled = Boolean(title);
  const armFill = variant === "mono" ? "currentColor" : MARK_COLORS.coral;
  const showTile = variant === "plaque";
  const showNode = variant !== "mono" || monoEmber;
  const emberFill = variant === "mono" ? "currentColor" : MARK_COLORS.bright;

  const rootClass = ["markStrike", still ? "markStrike--still" : "markStrike--play", className]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      className={rootClass}
      width={size}
      height={size}
      viewBox={g.viewBox}
      fill="none"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <defs>
        {/* Each mask is a thick white beam stroked down an arm's centreline. Its
            dash is fully retracted at rest (offset 1 = hidden) and animates to 0,
            painting the mask in and revealing the arm polygon mouth-to-base. */}
        <mask id={maskA} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <path className="markStrike__beam markStrike__beam--a" d={BEAM_A} pathLength={1} />
        </mask>
        <mask id={maskB} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <path className="markStrike__beam markStrike__beam--b" d={BEAM_B} pathLength={1} />
        </mask>
      </defs>
      {showTile ? <rect className="markStrike__tile" width="64" height="64" rx={g.plaqueRadius} fill={MARK_COLORS.inkDeep} /> : null}
      <polygon points={g.armA} fill={armFill} mask={`url(#${maskA})`} />
      <polygon points={g.armB} fill={armFill} mask={`url(#${maskB})`} />
      {showNode ? <circle className="markStrike__ember" cx={g.node.cx} cy={g.node.cy} r={g.node.r} fill={emberFill} /> : null}
    </svg>
  );
}
