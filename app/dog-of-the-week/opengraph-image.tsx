import { ImageResponse } from "next/og";

import {
  DOG_OF_THE_WEEK_EMPTY_LINE,
  DOG_OF_THE_WEEK_PATH,
  DOG_OF_THE_WEEK_TITLE,
  dogOfTheWeekMetLine,
} from "@/lib/dogOfTheWeek";
import { loadDogOfTheWeek } from "@/lib/dogOfTheWeek.server";
import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";

// The share card for /dog-of-the-week: the title and where this week's dog
// was met. A text card with no photo and no handle, because the edge holds a
// card for up to a day and a photo or a name taken down in that window must
// not keep travelling; the page itself carries both, read per request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Dog of the week, from the PUBMAXX photo wall";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const read = await loadDogOfTheWeek();
  const dog = read.status === "ready" ? read.dog : null;
  const line = dog
    ? clampOgText(dogOfTheWeekMetLine(dog), 60, "", {
        collapseWhitespace: true,
        collapseBeforeFilter: true,
      })
    : DOG_OF_THE_WEEK_EMPTY_LINE;

  return new ImageResponse(
    <CardShell>
      <div style={{ display: "flex", width: "100%" }}>
        <Wordmark />
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
          Photo wall
        </div>
        <div
          style={{
            display: "flex",
            color: OG.ink,
            fontSize: 120,
            fontWeight: 700,
            letterSpacing: -4,
            lineHeight: 0.95,
          }}
        >
          {DOG_OF_THE_WEEK_TITLE}
        </div>
        <div style={{ display: "flex", color: OG.inkSoft, fontSize: 40, marginTop: 26 }}>
          {line}
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
        <div style={{ display: "flex" }}>From the photo wall</div>
        <div style={{ display: "flex", color: OG.inkSoft }}>{`pubmaxxing.com${DOG_OF_THE_WEEK_PATH}`}</div>
      </div>
    </CardShell>,
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
