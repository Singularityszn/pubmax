import {
  LONDON_MAP_OUTLINES,
  LONDON_MAP_PINS,
  LONDON_MAP_PUB_COUNT,
  LONDON_MAP_PUB_DOTS,
  LONDON_MAP_VIEWBOX,
} from "./londonMapGeometry";
import styles from "./landing.module.css";

// The picture at the top of the front door: London, the historic pubs on it,
// and a few of them named.
//
// It is INLINE geometry rather than an image file or the live MapLibre canvas.
// Inline costs no request, so the largest thing on the landing paints with the
// document itself; it takes the reader's own theme tokens, so the drawing is
// right in dark mode without a second file; and it is vector, so it is sharp at
// 390px and at 1440px from one set of bytes. scripts/landing/build-landing-map.mjs
// generates the geometry from the borough outlines and the heritage dataset,
// and __tests__/landingMapSnapshot.test.ts holds its size and its honesty.
//
// The drawing is decoration to a screen reader: every fact it carries is said
// in the words beside it, so the SVG is hidden and the figure carries the
// caption. A reader who wants the real map is one tap away.

export default function LondonMapSnapshot({ className }: { className?: string }) {
  return (
    <svg
      className={[styles.lpMapSnapshot, className].filter(Boolean).join(" ")}
      viewBox={LONDON_MAP_VIEWBOX}
      role="img"
      aria-label={`A map of London with ${LONDON_MAP_PUB_COUNT} historic pubs marked, ${LONDON_MAP_PINS.length} of them named.`}
      focusable="false"
    >
      <path className={styles.lpMapOutline} d={LONDON_MAP_OUTLINES} />
      {/* Every pub dot in ONE path. One element each cost 293 layout objects
          on a phone the landing is trying to paint in under a second. */}
      <path className={styles.lpMapDots} d={LONDON_MAP_PUB_DOTS} />
      <g className="lpMapPins">
        {LONDON_MAP_PINS.map((pin) => (
          <g key={pin.slug} transform={`translate(${pin.x} ${pin.y})`}>
            <circle className={styles.lpMapPinDot} r="8" />
            {/* The generator sets the writing clear of every named pin. A plain
                dot may sit under it; the label's halo keeps it legible. */}
            <text
              className={styles.lpMapPinName}
              x={pin.anchor === "end" ? -pin.dx : pin.dx}
              y={pin.dy - 2}
              textAnchor={pin.anchor}
            >
              {pin.name}
            </text>
            <text
              className={styles.lpMapPinLabel}
              x={pin.anchor === "end" ? -pin.dx : pin.dx}
              y={pin.dy + 24}
              textAnchor={pin.anchor}
            >
              {pin.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
