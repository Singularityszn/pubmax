import { ImageResponse } from "next/og";

import { getCity, parseCityId } from "@/lib/cities";

// City-scoped OG fallback (no searchParams). Band-aware cards are served via
// `/api/city-map-card` and attached in generateMetadata when `?band=` is present.

export const runtime = "nodejs";
export const alt = "PUBMAXXING city map";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#191927";
const INK_DEEP = "#16122a";
const PAPER = "#fff4e8";
const PAPER_DIM = "#d8cfc2";
const CORAL = "#ff5a5f";
const RIVER = "#3f5566";

const display = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

function PintGlyph() {
  return (
    <svg width="44" height="50" viewBox="0 0 52 60" fill="none">
      <path
        d="M11 5 H41 L37 51 Q36 55 32 55 H20 Q16 55 15 51 Z"
        stroke={INK_DEEP}
        strokeWidth="3"
        fill="none"
      />
      <path d="M13 22 H39" stroke={INK_DEEP} strokeWidth="3" />
      <path d="M11 5 H41 L40 13 H12 Z" fill={INK_DEEP} />
    </svg>
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: raw } = await params;
  const cityId = parseCityId(raw);
  const city = cityId ? getCity(cityId) : null;
  const cityName = city?.displayName ?? "City";
  const tagline = city?.tagline ?? "Price-aware pub crawls";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `linear-gradient(145deg, ${INK_DEEP} 0%, ${INK} 48%, ${RIVER} 100%)`,
          color: PAPER,
          padding: 64,
          fontFamily: display,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -40,
            width: 520,
            height: 520,
            borderRadius: 999,
            background:
              "radial-gradient(circle, rgba(255,90,95,0.28) 0%, transparent 68%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: "2px solid rgba(255,90,95,0.35)",
            borderRadius: 8,
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: 68,
              height: 68,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 14,
              background: CORAL,
              marginRight: 22,
            }}
          >
            <PintGlyph />
          </div>
          <div
            style={{
              fontSize: 42,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            PUBMAXXING
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", zIndex: 1 }}>
          <div
            style={{
              display: "flex",
              fontSize: cityName.length > 12 ? 88 : 104,
              lineHeight: 1.02,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            {cityName}
          </div>
          <div
            style={{
              display: "flex",
              color: PAPER_DIM,
              fontSize: 30,
              lineHeight: 1.35,
              marginTop: 22,
              maxWidth: 820,
            }}
          >
            {tagline}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            color: CORAL,
            fontSize: 24,
            fontWeight: 700,
            zIndex: 1,
          }}
        >
          pubmaxxing.com
        </div>
      </div>
    ),
    size,
  );
}
