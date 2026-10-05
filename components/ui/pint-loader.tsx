import { useId } from "react";

import "./pintLoader.css";

/**
 * The shared blocking-load indicator: a pint glass that pours, settles its
 * head and holds. Use it only where a blocking wait is unavoidable (a route
 * held frame, the map's first frame). Where content can render progressively,
 * keep the skeleton.
 *
 * Hand-built SVG plus CSS: no runtime, no raster, no script. Every moving
 * part is a transform or opacity change, so it stays on the compositor. The
 * reduced-motion version is the same glass, full, with no motion at all.
 *
 * The component paints no live region of its own. The caller owns the one
 * `role="status"` and the one accessible name, so a frame never announces
 * itself twice. `label` is the visible line and is optional. `labelSize`
 * "quiet" is the smaller line a route shell prints under its skeleton.
 */
export type PintLoaderSize = "sm" | "md";
export type PintLoaderLabelSize = "default" | "quiet";

const BUBBLES: { x: number; r: number; delay: number; dur: number }[] = [
  { x: 25, r: 1.4, delay: 0.5, dur: 1.7 },
  { x: 33, r: 1, delay: 1.1, dur: 1.3 },
  { x: 40, r: 1.7, delay: 0.2, dur: 1.9 },
  { x: 47, r: 0.9, delay: 1.6, dur: 1.2 },
  { x: 54, r: 1.3, delay: 0.8, dur: 1.5 },
];

export default function PintLoader({
  size = "md",
  label,
  labelSize = "default",
  className,
}: {
  size?: PintLoaderSize;
  label?: string;
  labelSize?: PintLoaderLabelSize;
  className?: string;
}) {
  const id = useId();
  const beerId = `${id}-beer`;
  const insideId = `${id}-inside`;
  const classes = [
    "pintLoader",
    `pintLoader--${size}`,
    labelSize === "quiet" ? "pintLoader--quietLabel" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      <svg
        className="pintLoaderGlass"
        viewBox="0 0 80 112"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={beerId} x1="0" y1="0" x2="0" y2="1">
            <stop className="pintLoaderBeerTop" offset="0" />
            <stop className="pintLoaderBeerBottom" offset="1" />
          </linearGradient>
          <clipPath id={insideId}>
            <path d="M16 10 H64 L58 100 Q57.6 104 53 104 H27 Q22.4 104 22 100 Z" />
          </clipPath>
        </defs>
        <ellipse className="pintLoaderShadow" cx="40" cy="108" rx="24" ry="3" />
        <g clipPath={`url(#${insideId})`}>
          <g className="pintLoaderFill">
            <rect x="10" y="10" width="60" height="100" fill={`url(#${beerId})`} />
            <path className="pintLoaderHead" d="M10 10 H70 V19 Q55 23 40 19 T10 19 Z" />
            {BUBBLES.map((bubble) => (
              <circle
                key={bubble.x}
                className="pintLoaderBubble"
                cx={bubble.x}
                cy={96}
                r={bubble.r}
                style={{ animationDelay: `${bubble.delay}s`, animationDuration: `${bubble.dur}s` }}
              />
            ))}
          </g>
          <path className="pintLoaderGleam" d="M22 16 L25 96" />
        </g>
        <path
          className="pintLoaderRim"
          d="M16 10 H64 L58 100 Q57.6 104 53 104 H27 Q22.4 104 22 100 Z"
        />
      </svg>
      {label ? <span className="pintLoaderLabel">{label}</span> : null}
    </span>
  );
}
