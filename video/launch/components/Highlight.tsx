// A coral ring the video draws over a real control. It never covers the
// control: the stroke sits outside the control's own box, with a soft glow, so
// the words inside stay readable.

import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import type { CaptureRect } from "./ScreenCamera";
import { COLOURS } from "../theme";

type HighlightProps = {
  /** The control's box, already mapped into window pixels. */
  rect: CaptureRect;
  /** Frame (inside the parent sequence) the ring starts to appear. */
  from: number;
  /** Frame the ring has gone again; omit to hold it to the end. */
  until?: number;
  colour?: string;
  /** Space between the control and the ring, in window pixels. */
  gap?: number;
  radius?: number;
};

export function Highlight({ rect, from, until, colour = COLOURS.coral, gap = 10, radius = 22 }: HighlightProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grow = spring({ frame: frame - from, fps, config: { damping: 18, stiffness: 170 } });
  const fade =
    until === undefined
      ? 1
      : interpolate(frame, [until - 8, until], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.quad),
        });
  if (frame < from) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x - gap,
        top: rect.y - gap,
        width: rect.w + gap * 2,
        height: rect.h + gap * 2,
        borderRadius: radius,
        border: `6px solid ${colour}`,
        boxShadow: `0 0 0 6px ${colour}33, 0 0 36px ${colour}88`,
        opacity: grow * fade,
        scale: String(interpolate(grow, [0, 1], [1.12, 1])),
        pointerEvents: "none",
      }}
    />
  );
}

type GlideProps = {
  /** The boxes, in window pixels, the ring travels through in order. */
  rects: readonly CaptureRect[];
  /** The frame the ring arrives at each box. */
  at: readonly number[];
  colour?: string;
  gap?: number;
  radius?: number;
};

/**
 * One ring that glides from box to box, for walking the eye down a list.
 * Repeat a box at two frames to make the ring rest on it.
 */
export function GlideHighlight({ rects, at, colour = COLOURS.coral, gap = 10, radius = 22 }: GlideProps) {
  const frame = useCurrentFrame();
  const along = (pick: (rect: CaptureRect) => number) =>
    interpolate(frame, [...at], rects.map(pick), {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.65, 0, 0.35, 1),
    });
  const rect = { x: along((r) => r.x), y: along((r) => r.y), w: along((r) => r.w), h: along((r) => r.h) };
  return <Highlight rect={rect} from={at[0] ?? 0} colour={colour} gap={gap} radius={radius} />;
}
