// Issue #35 — route-level map skeleton. This paints the instant the /map route
// chunk begins loading (Next.js renders it while app/map/page.tsx + the dynamic
// PubMap import resolve), so the jump from the instant landing to /map is a
// beautiful held frame, not an abrupt blank.
//
// It's a pitched-London impression: a simple SVG river curve over a soft grid,
// with pulsing price-coloured dots (the same pint/amber/brick idiom the real
// pins use). Continued seamlessly by PubMap's own .mapLoading while the WebGL
// canvas style loads. All colour comes from existing tokens; reduced-motion
// holds the dots still (see the .mapSkeleton rules in app/globals.css).

// Dot positions are hand-placed to read as a loose scatter of London pubs, each
// tagged with a price bucket so the three price colours all appear. The stagger
// index drives the pulse delay so the field breathes rather than blinks in unison.
const SKELETON_DOTS: { x: number; y: number; bucket: "pint" | "amber" | "brick"; delay: number }[] =
  [
    { x: 74, y: 96, bucket: "pint", delay: 0 },
    { x: 128, y: 72, bucket: "amber", delay: 0.2 },
    { x: 176, y: 118, bucket: "pint", delay: 0.5 },
    { x: 214, y: 84, bucket: "brick", delay: 0.15 },
    { x: 96, y: 148, bucket: "amber", delay: 0.6 },
    { x: 158, y: 168, bucket: "pint", delay: 0.35 },
    { x: 242, y: 138, bucket: "amber", delay: 0.45 },
    { x: 288, y: 104, bucket: "pint", delay: 0.25 },
    { x: 268, y: 176, bucket: "brick", delay: 0.55 },
    { x: 118, y: 118, bucket: "pint", delay: 0.7 },
    { x: 196, y: 62, bucket: "pint", delay: 0.4 },
    { x: 320, y: 150, bucket: "amber", delay: 0.3 },
  ];

const BUCKET_VAR: Record<"pint" | "amber" | "brick", string> = {
  pint: "var(--pint)",
  amber: "var(--amber)",
  brick: "var(--brick)",
};

export default function MapLoading() {
  return (
    <main className="mapSkeleton" aria-busy="true" aria-live="polite">
      <div className="mapSkeletonInner">
        <svg
          className="mapSkeletonMap"
          viewBox="0 0 380 240"
          role="img"
          aria-label="Loading the London pub map"
          preserveAspectRatio="xMidYMid slice"
        >
          {/* River Thames — a single soft curve, the one shape that says London
              at a glance. Token-tinted so it flips with the theme. */}
          <path
            className="mapSkeletonRiver"
            d="M -10 128 C 60 108, 100 150, 150 150 S 236 118, 286 132 S 360 150, 400 138"
            fill="none"
          />
          {/* Pulsing price-coloured pubs. */}
          {SKELETON_DOTS.map((dot, index) => (
            <circle
              key={index}
              className="mapSkeletonDot"
              cx={dot.x}
              cy={dot.y}
              r={5}
              fill={BUCKET_VAR[dot.bucket]}
              style={{ animationDelay: `${dot.delay}s` }}
            />
          ))}
        </svg>
        <p className="mapSkeletonCopy">
          <span aria-hidden="true" className="mapSkeletonSpinnerDot" />
          Pouring the map…
        </p>
      </div>
    </main>
  );
}
