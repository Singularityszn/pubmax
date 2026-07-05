import { ImageResponse } from "next/og";

export const runtime = "edge";

const size = {
  width: 1200,
  height: 630,
};

// Brand palette (matches the app's "printed guidebook" aesthetic)
const PAPER = "#12100c"; // deep charcoal-green paper
const CREAM = "#ece3d2"; // warm cream ink
const CREAM_DIM = "#a99f8b"; // faded ink for supporting text
const BRASS = "#d3a44a"; // single accent
const RIVER = "#3f5566"; // muted Thames blue

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

// A small pint-glass glyph built from inline SVG (no external asset, no font emoji).
function PintGlyph() {
  return (
    <svg width="52" height="60" viewBox="0 0 52 60" fill="none">
      <path
        d="M11 5 H41 L37 51 Q36 55 32 55 H20 Q16 55 15 51 Z"
        stroke={PAPER}
        strokeWidth="3"
        fill="none"
      />
      {/* the pour line */}
      <path d="M13 22 H39" stroke={PAPER} strokeWidth="3" />
      {/* foam head */}
      <path d="M11 5 H41 L40 13 H12 Z" fill={PAPER} />
    </svg>
  );
}

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: CREAM,
          padding: 68,
          fontFamily: sans,
          position: "relative",
        }}
      >
        {/* Hairline field-guide border */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: `2px solid rgba(211,164,74,0.42)`,
            borderRadius: 6,
            display: "flex",
          }}
        />

        {/* A single Thames-ish river bend + brass dashed route across the lower third */}
        <svg
          width="1200"
          height="630"
          viewBox="0 0 1200 630"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <path
            d="M-40 430 C 260 360, 360 520, 640 470 S 980 380, 1260 460"
            stroke={RIVER}
            strokeWidth="26"
            fill="none"
            opacity="0.32"
            strokeLinecap="round"
          />
          <path
            d="M120 545 C 340 500, 470 588, 700 540 S 1010 470, 1120 512"
            stroke={BRASS}
            strokeWidth="3"
            strokeDasharray="2 14"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          {/* three price pins along the brass route */}
          <circle cx="230" cy="521" r="7" fill={BRASS} />
          <circle cx="700" cy="540" r="7" fill={BRASS} />
          <circle cx="1088" cy="509" r="7" fill={BRASS} />
        </svg>

        {/* Header: wordmark lockup + edition line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 76,
                height: 76,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                background: BRASS,
                marginRight: 26,
              }}
            >
              <PintGlyph />
            </div>
            <div
              style={{
                fontFamily: serif,
                fontSize: 46,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              PUBMAXXING
            </div>
          </div>
          <div
            style={{
              fontFamily: serif,
              fontStyle: "italic",
              color: BRASS,
              fontSize: 24,
              letterSpacing: 2,
            }}
          >
            A London Field Guide
          </div>
        </div>

        {/* Center: headline + tagline */}
        <div style={{ display: "flex", flexDirection: "column", zIndex: 1 }}>
          <div
            style={{
              color: BRASS,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 6,
              textTransform: "uppercase",
              marginBottom: 22,
            }}
          >
            Price-aware · Story-led · London
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: serif,
              maxWidth: 960,
              fontSize: 88,
              lineHeight: 1.02,
              fontWeight: 700,
            }}
          >
            Every real pint price in London, on a living map.
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 780,
              color: CREAM_DIM,
              fontSize: 30,
              lineHeight: 1.4,
              marginTop: 26,
            }}
          >
            Plan a crawl by price and story — heritage stops, live Pint Drops,
            and a route worth walking.
          </div>
        </div>

        {/* Footer: URL + brass rule */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontFamily: serif,
              fontStyle: "italic",
              color: CREAM,
              fontSize: 30,
            }}
          >
            Every pint has a story.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: BRASS,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                width: 46,
                height: 2,
                background: BRASS,
                marginRight: 18,
              }}
            />
            pubmaxing.app
          </div>
        </div>
      </div>
    ),
    size,
  );
}
