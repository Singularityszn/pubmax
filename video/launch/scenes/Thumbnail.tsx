// The post's thumbnail: one still that says the whole idea. The real logo,
// the core line, the real route Plan built (Feeley's, The Stonhouse, The
// Belle Vue) and one chat bubble asking the question the product answers.

import { AbsoluteFill } from "remotion";

import { BrandLockup } from "../components/Brand";
import { ScreenCamera } from "../components/ScreenCamera";
import marks from "../screens.json";
import { COLOURS, COPY, FONTS } from "../theme";
import { Backdrop } from "./Backdrop";

const WINDOW = { x: 60, y: 372, w: 960, h: 628 } as const;

export function Thumbnail() {
  const scale = marks.scale;
  const width = 506;
  const crop = { x: -58 * scale, y: 236 * scale, w: width * scale, h: (width * WINDOW.h * scale) / WINDOW.w };
  // The core line, broken before "into" so it sets as two even lines.
  const breakAt = COPY.idea.indexOf(" into ");
  const first = COPY.idea.slice(0, breakAt);
  const second = COPY.idea.slice(breakAt + 1);
  return (
    <AbsoluteFill>
      <Backdrop />
      <BrandLockup size={40} style={{ position: "absolute", top: 72, left: 80 }} />
      <div
        style={{
          position: "absolute",
          top: 150,
          left: 80,
          fontFamily: FONTS.headline,
          fontWeight: 700,
          fontSize: 86,
          letterSpacing: "-0.035em",
          lineHeight: 1.04,
          color: COLOURS.paper,
          whiteSpace: "nowrap",
        }}
        aria-label={COPY.idea}
      >
        <div>{first}</div>
        <div>
          {second?.slice(0, -1)}
          <span style={{ color: COLOURS.coral }}>.</span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: WINDOW.x,
          top: WINDOW.y,
          width: WINDOW.w,
          height: WINDOW.h,
          borderRadius: 40,
          overflow: "hidden",
          backgroundColor: COLOURS.night,
          boxShadow: "0 0 0 2px rgba(248, 242, 236, 0.10), 0 30px 80px rgba(0, 0, 0, 0.55)",
        }}
      >
        <ScreenCamera src="screens/plan-route.png" width={WINDOW.w} height={WINDOW.h} keys={[{ frame: 0, rect: crop }]} />
      </div>
      <div
        style={{
          position: "absolute",
          right: 66,
          top: 280,
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
        }}
      >
        <div
          style={{
            fontFamily: FONTS.body,
            fontWeight: 700,
            fontSize: 60,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: COLOURS.paper,
            background: COLOURS.nightRaised,
            padding: "22px 34px 26px",
            borderRadius: 36,
            borderBottomRightRadius: 10,
            boxShadow: "0 18px 40px rgba(0, 0, 0, 0.5)",
          }}
        >
          {COPY.chat[0]}
        </div>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: COLOURS.coral }} />
      </div>
    </AbsoluteFill>
  );
}
