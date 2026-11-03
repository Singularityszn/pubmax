// 16 to 20 seconds: the end card. The 3D Pal stands above the real logo, the
// line, the promise and the address. The address is at full strength on the
// card's first frame and never moves.

import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { BrandLockup } from "../components/Brand";
import { COLOURS, FONTS } from "../theme";
import { PAL_COPY } from "./palTheme";

export function PalEnd() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame: frame - 4, fps, config: { damping: 24, stiffness: 110 } });
  const line = spring({ frame: frame - 9, fps, config: { damping: 24, stiffness: 110 } });
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 474,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <BrandLockup
          size={88}
          style={{ opacity: logo, scale: String(interpolate(logo, [0, 1], [0.94, 1])) }}
        />
        <div
          style={{
            marginTop: 38,
            fontFamily: FONTS.headline,
            fontWeight: 700,
            fontSize: 70,
            lineHeight: 1.02,
            letterSpacing: "-0.035em",
            color: COLOURS.paper,
            whiteSpace: "nowrap",
            opacity: line,
            translate: `0px ${interpolate(line, [0, 1], [20, 0])}px`,
          }}
        >
          {PAL_COPY.end.slice(0, -1)}
          <span style={{ color: COLOURS.coral }}>.</span>
        </div>
        <div
          style={{
            marginTop: 16,
            fontFamily: FONTS.body,
            fontWeight: 600,
            fontSize: 38,
            letterSpacing: "-0.015em",
            color: COLOURS.paperMuted,
            opacity: line,
          }}
        >
          {PAL_COPY.promise}
        </div>
        {/* The address: no entrance, no motion, full contrast from frame 0. */}
        <div
          style={{
            marginTop: 40,
            padding: "20px 44px 24px",
            borderRadius: 999,
            backgroundColor: COLOURS.coral,
            fontFamily: FONTS.body,
            fontWeight: 700,
            fontSize: 68,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: COLOURS.night,
          }}
        >
          {PAL_COPY.url}
        </div>
      </div>
    </AbsoluteFill>
  );
}
