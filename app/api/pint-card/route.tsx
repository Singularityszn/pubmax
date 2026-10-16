import { ImageResponse } from "next/og";

import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import {
  CardShell,
  OG,
  OG_CACHE_HEADERS,
  OG_SIZE,
  Wordmark,
  loadOgFonts,
  priceStamp,
} from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { pintShareSourceLine } from "@/lib/pintShare";
import { resolvePintShare } from "@/lib/pintShare.server";

// The pint share card: the preview behind "Share this pint" (lib/pintShare.ts).
// One pub, its listed pint, its area and who listed it when. A route rather
// than an `opengraph-image` file because the card belongs to a `/map` query
// (`?sel=<id>&card=pint`) and an opengraph-image cannot read searchParams.
//
// The query names the pub and nothing else. The figure, the publisher and the
// day are read from the venue dataset (`resolvePintShare`), and a pub whose
// pint lacks any of the three is drawn with NO figure at all, never a figure
// without its source line. An unknown id draws the plain map poster.
//
// runtime = "nodejs": the venue packs and the Space Grotesk fonts are read
// from the filesystem.

export const runtime = "nodejs";

const VENUE_PARAM = "venue";

export async function GET(request: Request) {
  const limited = await ogCardRateLimitedResponse(request, "og-pint-card");
  if (limited) return limited;

  const raw = clampOgText(new URL(request.url).searchParams.get(VENUE_PARAM), 96, "", {
    collapseWhitespace: true,
  });
  const { venue, share } = raw ? await resolvePintShare(raw) : { venue: null, share: null };

  const name = clampOgText(venue?.name, 40, "A London pub", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  const area = clampOgText(venue?.area, 32, "London", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  const figure = share ? priceStamp(share.priceGbp) : null;
  const sourceLine = share && figure
    ? clampOgText(pintShareSourceLine(share), 64, "", { collapseWhitespace: true })
    : "";
  // The figure and its source line are drawn together or not at all.
  const showFigure = Boolean(figure && sourceLine);
  const nameSize = name.length > 26 ? 58 : name.length > 18 ? 70 : 84;

  return new ImageResponse(
    (
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
            {showFigure ? "Listed pint" : "Pub map"}
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
            {area}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: nameSize,
              fontWeight: 700,
              letterSpacing: -1,
              lineHeight: 1.0,
              color: OG.ink,
            }}
          >
            {name}
          </div>

          {showFigure ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 28 }}>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 160,
                    fontWeight: 700,
                    lineHeight: 0.9,
                    letterSpacing: -4,
                    color: OG.coral,
                  }}
                >
                  {figure}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 40,
                    fontWeight: 700,
                    color: OG.inkSoft,
                    marginLeft: 20,
                    marginBottom: 12,
                  }}
                >
                  a pint
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 28,
                  color: OG.inkSoft,
                  marginTop: 18,
                  letterSpacing: 0.5,
                }}
              >
                {`Cheapest pint on record, ${sourceLine}`}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                fontSize: 30,
                color: OG.inkSoft,
                marginTop: 30,
              }}
            >
              Listed pint prices across London, each with its source.
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
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
    { ...OG_SIZE, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
