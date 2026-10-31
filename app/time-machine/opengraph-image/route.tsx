import { ImageResponse } from "next/og";

import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";
import {
  pubCountLabel,
  resolveTimeMachineYear,
  rowsForYear,
  timeMachineExampleLine,
} from "@/lib/priceTimeMachine";

import { loadTimeMachine } from "../timeMachineData";

// The time machine's share card. The page owns its image metadata and points
// it here with the year it is showing (`?year=`), the way /tonight points at
// its own card, because a file-convention card cannot read a search param.
// The card prints the year, the count of pubs with a dated record in it and
// up to three of their lines, cheapest first, each with its month. A year
// with no record says so and prints no line.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const data = await loadTimeMachine();
  const url = new URL(request.url);
  const year = data ? resolveTimeMachineYear(data, url.searchParams.get("year")) : null;
  const rows = data && year !== null ? rowsForYear(data, year) : [];
  const examples = rows.slice(0, 3).map(timeMachineExampleLine);
  const headline = year !== null ? `Pints in ${year}` : "Pint price time machine";
  const countLine =
    year === null
      ? "Dated pint prices from London pub reviews."
      : rows.length === 0
        ? `No pub has a dated record from ${year}.`
        : `${pubCountLabel(rows.length)} with a dated record in ${year}`;

  return new ImageResponse(
    (
      <CardShell>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <Wordmark />
          <div style={{ display: "flex", color: OG.amber, fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>
            Time machine
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 1040 }}>
          <div style={{ display: "flex", color: OG.ink, fontSize: 88, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
            {headline}
          </div>
          <div style={{ display: "flex", color: OG.inkSoft, fontSize: 34, lineHeight: 1.3, marginTop: 20 }}>{countLine}</div>
          {examples.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 22 }}>
              {examples.map((line) => (
                <div key={line} style={{ display: "flex", color: OG.muted, fontSize: 28, lineHeight: 1.4 }}>
                  {line}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", color: OG.muted, fontSize: 21 }}>
          {year !== null ? `pubmaxxing.com/time-machine?year=${year}` : "pubmaxxing.com/time-machine"}
        </div>
      </CardShell>
    ),
    { ...OG_SIZE, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
