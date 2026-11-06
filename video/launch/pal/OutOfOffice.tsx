// 14 to 16 seconds: the payoff. The admin is done, the screen drops away, the
// Pal takes a bow, and you are out of office.

import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { COLOURS, FONTS } from "../theme";
import { PAL_COPY, PAL_SCENES } from "./palTheme";

export function OutOfOffice() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 12, fps, config: { damping: 18, stiffness: 150 } });
  const line = spring({ frame: frame - 18, fps, config: { damping: 22, stiffness: 140 } });
  const leave = interpolate(frame, [PAL_SCENES.out.durationInFrames - 8, PAL_SCENES.out.durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ opacity: 1 - leave }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 716,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            padding: "8px 18px 10px",
            borderRadius: 10,
            border: `2px solid ${COLOURS.coral}`,
            fontFamily: FONTS.headline,
            fontWeight: 700,
            fontSize: 26,
            letterSpacing: "0.16em",
            color: COLOURS.coral,
            opacity: enter,
          }}
        >
          {PAL_COPY.autoReply}
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: FONTS.headline,
            fontWeight: 700,
            fontSize: 112,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            color: COLOURS.paper,
            opacity: enter,
            scale: String(interpolate(enter, [0, 1], [0.9, 1])),
          }}
        >
          {PAL_COPY.out.slice(0, -1)}
          <span style={{ color: COLOURS.coral }}>.</span>
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: FONTS.body,
            fontWeight: 600,
            fontSize: 40,
            letterSpacing: "-0.02em",
            color: COLOURS.paperMuted,
            opacity: line,
            translate: `0px ${interpolate(line, [0, 1], [16, 0])}px`,
          }}
        >
          {PAL_COPY.outLine}
        </div>
      </div>
    </AbsoluteFill>
  );
}
