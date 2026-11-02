import "./pourLoader.css";

/**
 * THE POUR (round-two wild idea 04, docs/plans/DESIGN_UX_PLAN.md section 12).
 *
 * The drawing the shared pint loader (components/ui/pint-loader.tsx) paints in
 * place of its glass while the wild switch is on. It is the same glass in the
 * same box, so the loader keeps its sizes, its label and its silence to
 * assistive tech; only the picture changes.
 *
 * A lager fills from a stream falling from the top, bubbles rise through it
 * and a foam head forms and swells over the rim. A stout surges tan, then
 * settles dark from the bottom up under a creamy head.
 *
 * Hand-built SVG plus CSS (pourLoader.css): no runtime, no script, nothing to
 * load. Every moving part is a transform or an opacity change. With reduced
 * motion, and wherever the animation is held still, the drawing at rest is a
 * full, settled glass.
 */
export type PourKind = "lager" | "stout";

/** The inside of the glass: the same outline the classic loader draws. */
const GLASS = "M16 10 H64 L58 100 Q57.6 104 53 104 H27 Q22.4 104 22 100 Z";

/** The head swells out of the glass mouth once the glass is full. */
const CAP =
  "M17 10 C16.4 5.8 21.5 3.2 26.5 5 C29.6 1.4 35.6 0.8 40 3.2 C44.2 0.5 50.6 1 53.4 4.2 C58.2 3.2 63.6 6 63 10 Z";

/** The foam on the liquid, a finger deep: a soft wave on top, flat underneath. */
const HEAD = "M10 24 V11.5 Q18 13.4 26 11.6 T42 11.4 T58 11.8 T70 11.4 V24 Z";

type Bubble = { x: number; y: number; r: number; delay: number; dur: number };

/** Lager bubbles rise from the bottom of the glass. */
const LAGER_BUBBLES: readonly Bubble[] = [
  { x: 27, y: 98, r: 1.3, delay: 0.3, dur: 1.6 },
  { x: 33, y: 100, r: 0.9, delay: 0.9, dur: 1.2 },
  { x: 39, y: 97, r: 1.6, delay: 0.1, dur: 1.9 },
  { x: 45, y: 99, r: 1, delay: 1.4, dur: 1.4 },
  { x: 50, y: 98, r: 1.4, delay: 0.6, dur: 1.7 },
  { x: 54, y: 100, r: 0.8, delay: 1.1, dur: 1.3 },
];

/** A stout's surge cascades: its bubbles drift down the glass, not up. */
const STOUT_CASCADE: readonly Bubble[] = [
  { x: 25, y: 30, r: 0.9, delay: 0.2, dur: 1.5 },
  { x: 31, y: 38, r: 0.7, delay: 0.7, dur: 1.3 },
  { x: 37, y: 28, r: 1, delay: 1.1, dur: 1.7 },
  { x: 43, y: 34, r: 0.8, delay: 0.4, dur: 1.4 },
  { x: 49, y: 30, r: 0.9, delay: 0.9, dur: 1.6 },
  { x: 55, y: 36, r: 0.7, delay: 1.3, dur: 1.2 },
];

export default function PourGlass({ kind, idBase }: { kind: PourKind; idBase: string }) {
  const beerId = `${idBase}-pour-beer`;
  const insideId = `${idBase}-pour-inside`;
  const bubbles = kind === "stout" ? STOUT_CASCADE : LAGER_BUBBLES;
  return (
    <svg
      className={`pintLoaderGlass pourGlass pourGlass--${kind}`}
      viewBox="0 0 80 112"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={beerId} x1="0" y1="0" x2="0" y2="1">
          <stop className="pourBeerTop" offset="0" />
          <stop className="pourBeerBottom" offset="1" />
        </linearGradient>
        <clipPath id={insideId}>
          <path d={GLASS} />
        </clipPath>
      </defs>
      <ellipse className="pintLoaderShadow" cx="40" cy="108" rx="24" ry="3" />
      <g clipPath={`url(#${insideId})`}>
        <g className="pourFill">
          <g className="pourLiquid">
            <rect className="pourBody" x="10" y="20" width="60" height="90" fill={`url(#${beerId})`} />
            {bubbles.map((bubble) => (
              <circle
                key={bubble.x}
                className="pourBubble"
                cx={bubble.x}
                cy={bubble.y}
                r={bubble.r}
                style={{ animationDelay: `${bubble.delay}s`, animationDuration: `${bubble.dur}s` }}
              />
            ))}
            {kind === "stout" ? (
              <rect className="pourSettle" x="10" y="20" width="60" height="90" />
            ) : null}
            <path className="pourHead" d={HEAD} />
          </g>
        </g>
        <path className="pintLoaderGleam" d="M22 16 L25 96" />
      </g>
      <rect className="pourStream" x="38" y="0" width="4" height="104" rx="2" />
      <path className="pourCap" d={CAP} />
      <path className="pintLoaderRim" d={GLASS} />
    </svg>
  );
}
