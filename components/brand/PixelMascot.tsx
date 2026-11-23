import { MASCOT_GRID, mascotInset, mascotPaths, type MascotPose } from "@/lib/pixelMascot";

import "./pixelMascot.css";

/**
 * One of the Regulars (lib/pixelMascot.ts), drawn inline.
 *
 * Decoration only. The words beside it give the meaning, so it is hidden from
 * assistive technology and never replaces a label. `size` is a multiple
 * of the 16 pixel grid, because any other width blurs the pixels. `motion` is
 * "nod" for a wait and "hop" for a thing that just went right, and neither plays
 * under reduced motion. `onInk` is for a field that stays dark in both themes.
 * `flush` starts the drawing at its first pixel, so it lines up with
 * left-aligned words under it.
 */
export default function PixelMascot({
  pose,
  size = 48,
  motion = "still",
  onInk = false,
  flush = false,
  className,
}: {
  pose: MascotPose;
  size?: 32 | 48 | 64;
  motion?: "still" | "nod" | "hop";
  onInk?: boolean;
  flush?: boolean;
  className?: string;
}) {
  const classes = ["pixelMascot", onInk ? "pixelMascot--onInk" : null, className].filter(Boolean).join(" ");
  return (
    <svg
      className={classes}
      data-motion={motion === "still" ? undefined : motion}
      width={size}
      height={size}
      viewBox={`${flush ? mascotInset(pose) : 0} 0 ${MASCOT_GRID} ${MASCOT_GRID}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <g className="pixelMascotBody">
        {mascotPaths(pose).map(({ ink, d }) => (
          <path key={ink} className={`pixelMascotInk-${ink}`} d={d} />
        ))}
      </g>
    </svg>
  );
}
