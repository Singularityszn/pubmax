// 0 to 2 seconds: the hook. Three group-chat bubbles arrive fast, one per
// friend, while a small PUBMAXX lockup sits in the corner. The bubbles are
// illustrative: no names, no faces, no app interface is claimed here.

import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { BrandLockup } from "../components/Brand";
import { COLOURS, COPY, FONTS, SCENES } from "../theme";

/**
 * When each bubble starts to pop in, in frames. The first starts just before
 * the video does, so frame 0 already shows "Pub?" arriving. The pop sounds
 * play at the same frames (the first at frame 0).
 */
export const BUBBLE_FRAMES = [-4, 10, 22] as const;

const AVATARS = [COLOURS.coral, COLOURS.amber, "#7cc4ff"] as const;

function Bubble({ text, index }: { text: string; index: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = BUBBLE_FRAMES[index] ?? 0;
  const pop = spring({ frame: frame - land, fps, config: { damping: 14, stiffness: 220, mass: 0.7 } });
  const fromRight = index === 1;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: fromRight ? "row-reverse" : "row",
        alignItems: "flex-end",
        gap: 22,
        opacity: interpolate(pop, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
        scale: String(interpolate(pop, [0, 1], [0.6, 1])),
        translate: `0px ${interpolate(pop, [0, 1], [40, 0])}px`,
        transformOrigin: fromRight ? "100% 100%" : "0% 100%",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          flex: "0 0 auto",
          background: AVATARS[index],
          boxShadow: `0 0 0 6px ${COLOURS.night}`,
        }}
      />
      <div
        style={{
          fontFamily: FONTS.body,
          fontWeight: 700,
          fontSize: 92,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: fromRight ? COLOURS.night : COLOURS.paper,
          background: fromRight ? COLOURS.paper : COLOURS.nightRaised,
          padding: "30px 44px 34px",
          borderRadius: 48,
          borderBottomLeftRadius: fromRight ? 48 : 12,
          borderBottomRightRadius: fromRight ? 12 : 48,
          boxShadow: "0 18px 40px rgba(0, 0, 0, 0.45)",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </div>
  );
}

export function HookScene() {
  const frame = useCurrentFrame();
  const { durationInFrames } = SCENES.hook;
  // The chat lifts away as the map rises in under it.
  const leave = interpolate(frame, [durationInFrames - 9, durationInFrames + 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  return (
    <AbsoluteFill>
      {/* The lockup does not leave: the product stage paints the same one in
          the same place, so the brand mark stays on screen across the cut. */}
      <BrandLockup size={36} style={{ position: "absolute", top: 62, left: 80 }} />
      <div
        style={{
          opacity: 1 - leave,
          position: "absolute",
          left: 80,
          right: 80,
          top: 290,
          display: "flex",
          flexDirection: "column",
          gap: 54,
          translate: `0px ${-120 * leave}px`,
          scale: String(1 - 0.06 * leave),
        }}
      >
        {COPY.chat.map((text, index) => (
          <div key={text} style={{ display: "flex", justifyContent: index === 1 ? "flex-end" : "flex-start" }}>
            <Bubble text={text} index={index} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}
