// A stock-market ticker, for pints. It runs along the foot of the frame while
// the Pal works, and every item is one of the Pal's own picks, printed with
// its source and the date that source was read. No arrows: a ticker that
// pretended to know which way a price moved would be inventing a fact.

import { interpolate, useCurrentFrame } from "remotion";

import { COLOURS, FONTS } from "../theme";
import { PAL_TICKER } from "./palTheme";

const HEIGHT = 56;
const SPEED = 4; // pixels a frame

function Items() {
  return (
    <>
      {PAL_TICKER.map((item) => (
        <span key={item.pub} style={{ display: "inline-flex", alignItems: "baseline", gap: 14, marginRight: 56 }}>
          <span style={{ color: COLOURS.paper }}>{item.pub}</span>
          <span style={{ color: COLOURS.amber }}>{item.price}</span>
          <span style={{ color: COLOURS.paperMuted, fontSize: 20 }}>PINT PRICES, READ {item.read}</span>
        </span>
      ))}
    </>
  );
}

export function Ticker({ from, until }: { from: number; until: number }) {
  const frame = useCurrentFrame();
  const show = interpolate(frame, [from, from + 10, until - 8, until], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (show === 0) return null;
  const shift = (frame - from) * SPEED;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 18,
        height: HEIGHT,
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
        backgroundColor: "rgba(10, 10, 11, 0.92)",
        borderTop: "1px solid rgba(248, 242, 236, 0.12)",
        borderBottom: "1px solid rgba(248, 242, 236, 0.12)",
        opacity: show,
      }}
    >
      <div
        style={{
          position: "relative",
          zIndex: 1,
          flex: "0 0 auto",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 22px",
          backgroundColor: COLOURS.coral,
          color: COLOURS.night,
          fontFamily: FONTS.headline,
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: "0.12em",
        }}
      >
        LISTED PINT PRICES
      </div>
      <div
        style={{
          whiteSpace: "nowrap",
          fontFamily: FONTS.body,
          fontWeight: 700,
          fontSize: 24,
          letterSpacing: "0.02em",
          translate: `${-shift}px 0px`,
          paddingLeft: 40,
        }}
      >
        <Items />
        <Items />
        <Items />
      </div>
    </div>
  );
}
