// A camera over one real app capture.
//
// The capture is never redrawn or edited: the camera only chooses which part
// of it fills the window, and moves between those crops on eased keyframes.
// Highlights are given in the capture's own pixels and drawn on a layer above
// it, mapped through the same crop, so they stay on the button or row they
// point at while the camera moves, and their stroke stays a constant width.

import type { ReactNode } from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

/** A rectangle in the capture's own pixels. */
export type CaptureRect = { x: number; y: number; w: number; h: number };

type CameraKey = { frame: number; rect: CaptureRect };

type ScreenCameraProps = {
  /** The capture, relative to video/launch/public. */
  src: string;
  /** Window size in video pixels. */
  width: number;
  height: number;
  /** Crops over time. The window shows the crop scaled to cover it. */
  keys: readonly CameraKey[];
  /** Draws layers in window pixels; `toView` maps a capture rect into them. */
  overlay?: (toView: (rect: CaptureRect) => CaptureRect, scale: number) => ReactNode;
};

const MOVE = Easing.bezier(0.65, 0, 0.35, 1);

function cropAt(frame: number, keys: readonly CameraKey[]): CaptureRect {
  if (keys.length === 1) return keys[0]!.rect;
  const frames = keys.map((key) => key.frame);
  const along = (pick: (rect: CaptureRect) => number) =>
    interpolate(
      frame,
      frames,
      keys.map((key) => pick(key.rect)),
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: MOVE },
    );
  return { x: along((r) => r.x), y: along((r) => r.y), w: along((r) => r.w), h: along((r) => r.h) };
}

export function ScreenCamera({ src, width, height, keys, overlay }: ScreenCameraProps) {
  const frame = useCurrentFrame();
  const crop = cropAt(frame, keys);
  // Cover: the crop fills the window, centred on the axis with room to spare.
  const scale = Math.max(width / crop.w, height / crop.h);
  const offsetX = (width - crop.w * scale) / 2 - crop.x * scale;
  const offsetY = (height - crop.h * scale) / 2 - crop.y * scale;
  const toView = (rect: CaptureRect): CaptureRect => ({
    x: offsetX + rect.x * scale,
    y: offsetY + rect.y * scale,
    w: rect.w * scale,
    h: rect.h * scale,
  });

  return (
    <div style={{ position: "absolute", inset: 0, width, height, overflow: "hidden" }}>
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          translate: `${offsetX}px ${offsetY}px`,
          scale: String(scale),
          maxWidth: "none",
        }}
      />
      {overlay ? overlay(toView, scale) : null}
    </div>
  );
}
