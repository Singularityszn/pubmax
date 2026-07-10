import { ImageResponse } from "next/og";

import { getCity, parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { bandByIdForCity } from "@/lib/cityStoryBands";
import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";

// City map OG share card — cult / Freshers deep links (`?band=subcrawl` etc.).
// Query-aware route because opengraph-image.tsx cannot read searchParams.
// Palette: ink + coral (app tokens), not brass-cream guidebook or purple AI defaults.

export const runtime = "nodejs";

const size = {
  width: 1200,
  height: 630,
};

const INK = "#191927";
const INK_DEEP = "#16122a";
const PAPER = "#fff4e8";
const PAPER_DIM = "#d8cfc2";
const CORAL = "#ff5a5f";
const RIVER = "#3f5566";

const display = 'Helvetica, "Helvetica Neue", Arial, sans-serif';
const body = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

function clampParam(raw: string | null, max: number, fallback = ""): string {
  if (!raw) return fallback;
  const cleaned = Array.from(raw)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

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

export async function GET(request: Request) {
  const limited = await ogCardRateLimitedResponse(request, "og-city-map-card");
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const cityRaw = clampParam(searchParams.get("city"), 32, DEFAULT_CITY_ID);
  const cityId = parseCityId(cityRaw) ?? DEFAULT_CITY_ID;
  const city = getCity(cityId);
  const bandRaw = clampParam(searchParams.get("band"), 64);
  const band = bandRaw ? bandByIdForCity(cityId, bandRaw) : undefined;

  const cityName = clampParam(city.displayName, 40, "London");
  const tagline = clampParam(city.tagline, 72, "Price-aware pub crawls");
  const bandTitle = band ? clampParam(band.title, 48) : "";

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
          fontFamily: body,
          position: "relative",
        }}
      >
        {/* Soft coral wash — atmosphere, not a sticker overlay */}
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -40,
            width: 520,
            height: 520,
            borderRadius: 999,
            background: `radial-gradient(circle, rgba(255,90,95,0.28) 0%, transparent 68%)`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -120,
            left: -60,
            width: 480,
            height: 480,
            borderRadius: 999,
            background: `radial-gradient(circle, rgba(63,85,102,0.45) 0%, transparent 70%)`,
            display: "flex",
          }}
        />

        {/* Hairline frame */}
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

        {/* Header: wordmark */}
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
                fontFamily: display,
                fontSize: 42,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              PUBMAXXING
            </div>
          </div>
          <div
            style={{
              color: CORAL,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            City map
          </div>
        </div>

        {/* Hero: city name + optional band chip + tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            zIndex: 1,
            maxWidth: 980,
          }}
        >
          {bandTitle ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 22,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: INK_DEEP,
                  background: CORAL,
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  padding: "10px 20px",
                  borderRadius: 8,
                }}
              >
                {bandTitle}
              </div>
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              fontFamily: display,
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

        {/* Footer */}
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
              color: PAPER_DIM,
              fontSize: 26,
              fontStyle: "italic",
            }}
          >
            Every pint has a story.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: CORAL,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                width: 40,
                height: 2,
                background: CORAL,
                marginRight: 16,
              }}
            />
            pubmaxxing.com
          </div>
        </div>
      </div>
    ),
    size,
  );
}
