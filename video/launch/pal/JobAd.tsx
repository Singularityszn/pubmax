// 0 to 4 seconds: the hook. A job advert for the thing every group chat
// needs, ticked off line by line, then stamped HIRED as the 3D Pal arrives.

import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { COLOURS, FONTS } from "../theme";
import { PAL_COPY, PAL_SCENES } from "./palTheme";

/** When each duty ticks in, and when the stamp lands. Sounds use the same frames. */
export const DUTY_FRAMES = [8, 16, 24, 32] as const;
export const STAMP_FRAME = 66;

function Tick({ at }: { at: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const draw = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 200 } });
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" style={{ flex: "0 0 auto" }} aria-hidden="true">
      <rect x="2" y="2" width="40" height="40" rx="10" fill="none" stroke={COLOURS.night} strokeWidth="3" />
      <path
        d="M11 23 L19 31 L34 13"
        fill="none"
        stroke={COLOURS.coral}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="40"
        strokeDashoffset={40 * (1 - draw)}
      />
    </svg>
  );
}

export function JobAd({ still = false }: { still?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const now = still ? 200 : frame;
  // The advert is already on screen at frame 0, settling from a slight slam.
  const slam = spring({ frame: now + 4, fps, config: { damping: 16, stiffness: 180 } });
  const stamp = spring({ frame: now - STAMP_FRAME, fps, config: { damping: 12, stiffness: 260, mass: 0.8 } });
  const leave = still
    ? 0
    : interpolate(frame, [PAL_SCENES.chat.from - 16, PAL_SCENES.chat.from + 2], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.in(Easing.cubic),
      });
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 56,
          top: 196,
          width: 640,
          padding: "44px 48px 52px",
          borderRadius: 18,
          backgroundColor: COLOURS.paper,
          color: COLOURS.night,
          boxShadow: "0 30px 80px rgba(0, 0, 0, 0.55)",
          rotate: `${interpolate(slam, [0, 1], [-5, -2])}deg`,
          scale: String(interpolate(slam, [0, 1], [1.1, 1])),
          opacity: 1 - leave,
          translate: `${-260 * leave}px ${40 * leave}px`,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.headline,
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: "0.18em",
            color: COLOURS.coral,
          }}
        >
          {PAL_COPY.wanted}
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: FONTS.headline,
            fontWeight: 700,
            fontSize: 70,
            lineHeight: 1.02,
            letterSpacing: "-0.035em",
          }}
        >
          {PAL_COPY.job}
        </div>
        <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 20 }}>
          {PAL_COPY.duties.map((duty, index) => {
            const at = DUTY_FRAMES[index] ?? 0;
            const show = still ? 1 : interpolate(frame, [at - 2, at + 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <div
                key={duty}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 20,
                  opacity: show,
                  translate: `${(1 - show) * -18}px 0px`,
                }}
              >
                <Tick at={still ? -100 : at} />
                <span style={{ fontFamily: FONTS.body, fontWeight: 600, fontSize: 40, letterSpacing: "-0.02em" }}>
                  {duty}
                </span>
              </div>
            );
          })}
        </div>
        {/* The stamp: a coral rubber stamp, drawn, never part of the app. */}
        <div
          style={{
            position: "absolute",
            right: -46,
            top: -54,
            padding: "10px 30px 14px",
            border: `8px solid ${COLOURS.coral}`,
            borderRadius: 16,
            fontFamily: FONTS.headline,
            fontWeight: 700,
            fontSize: 92,
            letterSpacing: "0.08em",
            lineHeight: 1,
            color: COLOURS.coral,
            backgroundColor: "rgba(248, 242, 236, 0.86)",
            rotate: "-12deg",
            opacity: still ? 1 : interpolate(stamp, [0, 0.2], [0, 1], { extrapolateRight: "clamp" }),
            scale: String(still ? 1 : interpolate(stamp, [0, 1], [1.9, 1])),
            boxShadow: `0 0 0 3px rgba(255, 90, 95, 0.25)`,
          }}
        >
          {PAL_COPY.hired}
        </div>
      </div>
    </AbsoluteFill>
  );
}
