import { ImageResponse } from "next/og";

import { loadDrinkBrandLanding } from "@/lib/drinkBrandLanding.server";
import {
  CardShell,
  OG,
  OG_CACHE_HEADERS,
  OG_SIZE,
  Wordmark,
  clampText,
  loadOgFonts,
  priceStamp,
} from "@/lib/ogBrand";

export const runtime = "nodejs";
export const alt = "London drink brand pint prices. PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const landing = await loadDrinkBrandLanding(slug);
  const brand = clampText(landing?.brandLabel, 24, "London pints");
  const cheapest = priceStamp(landing?.rows[0]?.priceGbp ?? null);
  const pricedVenueCount = landing?.totalPricedVenues ?? 0;
  const route = `/drink/${encodeURIComponent(landing?.slug ?? slug)}`;

  return new ImageResponse(
    <CardShell>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <Wordmark />
        <div
          style={{
            display: "flex",
            color: OG.coral,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          Pint prices
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            color: OG.muted,
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Cheapest listed {brand} pints in London
        </div>
        <div
          style={{
            display: "flex",
            color: OG.coral,
            fontSize: 166,
            fontWeight: 700,
            letterSpacing: -5,
            lineHeight: 0.9,
          }}
        >
          {cheapest ?? "Prices checked"}
        </div>
        <div
          style={{
            display: "flex",
            color: OG.inkSoft,
            fontSize: 32,
            marginTop: 26,
          }}
        >
          {pricedVenueCount} priced venues
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          color: OG.muted,
          fontSize: 22,
        }}
      >
        <div style={{ display: "flex" }}>PUBMAXX pint evidence</div>
        <div style={{ display: "flex", color: OG.inkSoft }}>{`pubmaxxing.com${route}`}</div>
      </div>
    </CardShell>,
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
