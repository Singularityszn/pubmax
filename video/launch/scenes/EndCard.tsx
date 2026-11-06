// 12 to 15 seconds: the call to action. A clean card with the real logo, the
// main line and the address. The address is painted at full strength on the
// card's first frame and never moves, so it is readable for all three seconds.

import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { BrandLockup } from "../components/Brand";
import { COLOURS, COPY, FONTS } from "../theme";

export function EndCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame, fps, config: { damping: 24, stiffness: 110 } });
  const line = spring({ frame: frame - 5, fps, config: { damping: 24, stiffness: 110 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
        <BrandLockup
          size={128}
          style={{
            opacity: interpolate(logo, [0, 1], [0.0, 1]),
            scale: String(interpolate(logo, [0, 1], [0.92, 1])),
          }}
        />
        <div
          style={{
            marginTop: 72,
            fontFamily: FONTS.headline,
            fontWeight: 700,
            fontSize: 92,
            letterSpacing: "-0.035em",
            lineHeight: 1.02,
            color: COLOURS.paper,
            whiteSpace: "nowrap",
            opacity: line,
            translate: `0px ${interpolate(line, [0, 1], [26, 0])}px`,
          }}
        >
          {COPY.end.slice(0, -1)}
          <span style={{ color: COLOURS.coral }}>{COPY.end.slice(-1)}</span>
        </div>
        {/* The address: no entrance, no motion, full contrast from frame 0. */}
        <div
          style={{
            marginTop: 64,
            padding: "22px 46px 26px",
            borderRadius: 999,
            backgroundColor: COLOURS.coral,
            fontFamily: FONTS.body,
            fontWeight: 700,
            fontSize: 72,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: COLOURS.night,
          }}
        >
          {COPY.url}
        </div>
      </div>
    </AbsoluteFill>
  );
}
