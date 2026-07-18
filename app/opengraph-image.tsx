import { ImageResponse } from "next/og";

import { getVenueIndex } from "@/lib/venueIndex";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { listEnabledCities } from "@/lib/cities";
import {
  CardShell,
  OG,
  OG_CACHE_HEADERS,
  OG_SIZE,
  Wordmark,
  loadOgFonts,
} from "@/lib/ogBrand";

// Homepage / root OG hero card (Wave S2.5, Next `opengraph-image` convention).
// A root-level opengraph-image.tsx wins over the site-wide static
// openGraph.images("/og.png") set in app/layout.tsx for the "/" route, so a
// shared pubmaxxing.com link now shows this dynamic hero while /og.png stays as
// the global fallback for every other route without its own card.
//
// The two live numbers — tracked pubs + cities — are read from the same bundled
// dataset / city config the app uses, so the card can't overstate coverage.
//
// runtime = "nodejs": the pub count is read from the filesystem and the Space
// Grotesk fonts are read from public/fonts, both edge-incompatible.

export const runtime = "nodejs";
export const alt = "PUBMAXX. Make tonight worth remembering: real pint prices across London and beyond";
export const size = OG_SIZE;
export const contentType = "image/png";

// Count tracked pubs from the bundled dataset. Never throws — on any failure the
// card simply omits the count rather than 500-ing the share preview.
async function countPubs(): Promise<number | null> {
  try {
    await getVenueIndex();
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const file = path.join(
      process.cwd(),
      "public",
      "data",
      "pint_prices_app_dataset.json",
    );
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    return groupVenuePrices(Array.isArray(rows) ? rows : []).length;
  } catch {
    return null;
  }
}

export default async function Image() {
  const pubCount = await countPubs();
  // Cities beyond the London flagship.
  const otherCities = Math.max(0, listEnabledCities().length - 1);

  const coverageBits = [
    "Real pint prices",
    pubCount ? `${pubCount.toLocaleString("en-GB")} pubs tracked` : null,
    otherCities > 0 ? `London + ${otherCities} cities` : "London",
  ].filter(Boolean) as string[];

  return new ImageResponse(
    (
      <CardShell>
        {/* Header: wordmark + live coverage kicker */}
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
              alignItems: "center",
              color: OG.coral,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: OG.pint,
                marginRight: 12,
                display: "flex",
              }}
            />
            London is live
          </div>
        </div>

        {/* Middle: eyebrow → the tagline hero → supporting line */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              color: OG.coral,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 6,
              textTransform: "uppercase",
              marginBottom: 24,
            }}
          >
            Real prices · Live plans · Side quests
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 104,
              fontWeight: 700,
              letterSpacing: -3,
              lineHeight: 0.98,
              color: OG.ink,
              maxWidth: 1000,
            }}
          >
            <div style={{ display: "flex" }}>Make tonight</div>
            <div style={{ display: "flex" }}>
              worth{" "}
              <span style={{ color: OG.coral, display: "flex", marginLeft: 24 }}>
                remembering
              </span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              color: OG.inkSoft,
              fontSize: 30,
              lineHeight: 1.35,
              marginTop: 30,
              maxWidth: 860,
            }}
          >
            A price-aware nightlife map. Find the right place for your mood, plan
            the crawl, and turn a spontaneous night into a story worth keeping.
          </div>
        </div>

        {/* Footer: live coverage chips + URL */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {coverageBits.map((bit, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 ? (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: OG.muted,
                      margin: "0 16px",
                      display: "flex",
                    }}
                  />
                ) : null}
                <div
                  style={{
                    display: "flex",
                    color: i === 0 ? OG.inkSoft : OG.muted,
                    fontSize: 25,
                    fontWeight: i === 0 ? 700 : 500,
                  }}
                >
                  {bit}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: OG.coral,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                width: 44,
                height: 2,
                background: OG.coral,
                marginRight: 16,
              }}
            />
            pubmaxxing.com
          </div>
        </div>
      </CardShell>
    ),
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
