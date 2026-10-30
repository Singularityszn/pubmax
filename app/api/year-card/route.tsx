import { ImageResponse } from "next/og";

import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { londonDayKey } from "@/lib/pintContributions";
import {
  parseYearShare,
  yearShareHeading,
  yearShareLine,
  yearShareSpan,
  type YearShare,
} from "@/lib/yearInPints";
import { yearShareVenueNames } from "@/lib/yearInPints.server";
import { YearDotGlass } from "@/lib/yearInPintsDotGlass";

// The Year in Pints card: the preview behind a shared year (lib/yearInPints.ts).
// It draws only the lines the link holds, and the link holds only the lines
// the person ticked. Every number is checked by `parseYearShare` and a pub is
// named only from the venue dataset (`yearShareVenueNames`), so a link cannot
// put words of its own on the card. A link with no readable year draws the
// plain poster. The counts are ink, never coral: a year read back is not a
// score. When the nights line was ticked, a pint glass of the year's days
// stands beside them, lit one dot per night (lib/yearInPintsDotGlass.tsx).
//
// runtime = "nodejs": the venue index and the Space Grotesk fonts are read
// from the filesystem.

export const runtime = "nodejs";

type Count = { value: number; label: string };

function counts(share: YearShare): Count[] {
  const out: Count[] = [];
  if (share.nights !== undefined) out.push({ value: share.nights, label: share.nights === 1 ? "night out" : "nights out" });
  if (share.stops !== undefined) out.push({ value: share.stops, label: share.stops === 1 ? "stop walked" : "stops walked" });
  if (share.prices) {
    const label = share.prices.count === 1 ? "price mapped" : "prices mapped";
    out.push({
      value: share.prices.count,
      label: share.prices.boroughs > 1 ? `${label} across ${share.prices.boroughs} boroughs` : label,
    });
  }
  return out;
}

function lines(share: YearShare, names: Record<string, string>): string[] {
  const clamped = Object.fromEntries(
    Object.entries(names).map(([id, name]) => [
      id,
      clampOgText(name, 32, "", { collapseWhitespace: true, collapseBeforeFilter: true }),
    ]),
  );
  return (["month", "favourite", "first"] as const).flatMap((part) => {
    const line = yearShareLine(share, part, clamped);
    return line ? [line] : [];
  });
}

export async function GET(request: Request) {
  const limited = await ogCardRateLimitedResponse(request, "og-year-card");
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const share = parseYearShare(params.get("y"), params, londonDayKey(new Date()));
  const names = share ? await yearShareVenueNames(share) : {};
  const heading = share ? yearShareHeading(share) : "A Year in Pints";
  const span = share ? yearShareSpan(share) : null;
  const shareCounts = share ? counts(share) : [];
  const shareLines = share ? lines(share, names) : [];
  const glassNights = share?.nights;
  const countWidth = glassNights !== undefined ? 236 : 320;

  return new ImageResponse(
    (
      <CardShell padding={56}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
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
            Year in Pints
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 700, letterSpacing: -1, lineHeight: 1.02, color: OG.ink }}>
              {heading}
            </div>
            {span ? (
              <div style={{ display: "flex", fontSize: 26, color: OG.muted, marginTop: 8 }}>{span}</div>
            ) : null}
            {!share ? (
              <div style={{ display: "flex", fontSize: 30, color: OG.inkSoft, marginTop: 24 }}>
                A year of nights out, read back by your Pub Pal.
              </div>
            ) : null}

            {shareCounts.length > 0 ? (
              <div style={{ display: "flex", gap: 40, marginTop: 28 }}>
                {shareCounts.map((count) => (
                  <div key={count.label} style={{ display: "flex", flexDirection: "column", width: countWidth }}>
                    <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1, letterSpacing: -2, color: OG.ink }}>
                      {count.value.toLocaleString("en-GB")}
                    </div>
                    <div style={{ display: "flex", fontSize: 24, color: OG.inkSoft, marginTop: 6, lineHeight: 1.2 }}>
                      {count.label}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {shareLines.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 22 }}>
                {shareLines.map((line) => (
                  <div key={line} style={{ display: "flex", fontSize: 26, color: OG.inkSoft, lineHeight: 1.25 }}>
                    {line}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {share && glassNights !== undefined ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginLeft: 32 }}>
              <YearDotGlass year={share.year} through={share.through} nights={glassNights} width={200} height={340} />
              <div style={{ display: "flex", fontSize: 18, color: OG.muted, marginTop: 12 }}>Each dot is a day. Lit: a night out.</div>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", color: OG.coral, fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>
            <div style={{ width: 44, height: 2, background: OG.coral, marginRight: 16 }} />
            pubmaxxing.com
          </div>
        </div>
      </CardShell>
    ),
    { ...OG_SIZE, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
