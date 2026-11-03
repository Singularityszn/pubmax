// The night ground every scene sits on: deep night, with a low coral glow and
// an amber one drifting slowly, like light from a pub window across a street.

import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

import { COLOURS } from "../theme";

export function Backdrop() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const drift = interpolate(frame, [0, durationInFrames], [0, 1]);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLOURS.night,
        backgroundImage: [
          `radial-gradient(circle at ${18 + 10 * drift}% ${8 + 6 * drift}%, rgba(255, 90, 95, 0.16), transparent 46%)`,
          `radial-gradient(circle at ${88 - 8 * drift}% ${96 - 4 * drift}%, rgba(240, 160, 26, 0.12), transparent 50%)`,
        ].join(", "),
      }}
    />
  );
}
