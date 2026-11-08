import { ImageResponse } from "next/og";

import { displayHandle } from "@/lib/handleDisplay";
import {
  formatOpenCrawlShareSpendBand,
  openCrawlShareAreaLine,
  openCrawlShareDay,
  openCrawlSharePlacesLine,
  openCrawlShareTime,
  type OpenCrawlShareCard,
} from "@/lib/openCrawlShareCard";
import { loadOpenCrawlShareCard } from "@/lib/openCrawlShareCard.server";
import { isCrewId } from "@/lib/socialCrewsUi";
import { CardShell, OG, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";

// The Social Crews notice at /privacy#crews owns the public disclosure contract.
// A crew that is not open, or a read that cannot run, gets a plain PUBMAXX poster.
//
// runtime = "nodejs": loadOgFonts reads the Space Grotesk TTFs from
// public/fonts via node:fs, same as every sibling OG route.

export const runtime = "nodejs";
export const alt = "An open pub crawl on PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

const OPEN_CRAWL_OG_HEADERS = {
  "cache-control": "private, no-store",
} as const;

const OG_TEXT = { collapseWhitespace: true, collapseBeforeFilter: true } as const;

function Fact({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginRight: 56 }}>
      <div
        style={{
          display: "flex",
          color: OG.muted,
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 3,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", color: accent ?? OG.ink, fontSize: 34, fontWeight: 700, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}

function Poster() {
  return (
    <CardShell>
      <Wordmark />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: OG.ink }}>
          A night out
        </div>
        <div style={{ display: "flex", fontSize: 26, color: OG.muted, marginTop: 14 }}>
          A pub crawl planned on PUBMAXX.
        </div>
      </div>
      <div style={{ display: "flex", color: OG.muted, fontSize: 24 }}>pubmaxxing.com</div>
    </CardShell>
  );
}

function Card({ card }: { card: OpenCrawlShareCard }) {
  const title = clampOgText(card.title, 60, "A night out", OG_TEXT);
  const host = clampOgText(displayHandle(card.hostHandle), 32, "@host", OG_TEXT);
  const day = openCrawlShareDay(card.startsAt) ?? "Date to be confirmed";
  const time = openCrawlShareTime(card.startsAt);
  const area = openCrawlShareAreaLine(card.area);
  const places = openCrawlSharePlacesLine(card.placesLeft);
  const band = card.spendBand ? formatOpenCrawlShareSpendBand(card.spendBand) : null;
  return (
    <CardShell>
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
          Open crawl
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: title.length > 34 ? 54 : 66,
            fontWeight: 700,
            letterSpacing: -1,
            lineHeight: 1.05,
            color: OG.ink,
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", color: OG.inkSoft, fontSize: 28, marginTop: 12 }}>
          Hosted by {host}
          {area ? ` · ${clampOgText(area, 40, "", OG_TEXT)}` : ""}
        </div>
        <div style={{ display: "flex", color: OG.ink, fontSize: 30, marginTop: 22 }}>
          Meet at {clampOgText(card.meetingPubName, 44, "the first pub", OG_TEXT)}
        </div>
        <div style={{ display: "flex", marginTop: 30 }}>
          <Fact label="When" value={time ? `${day}, ${time}` : day} />
          {places ? <Fact label="Places" value={places} accent={OG.pint} /> : null}
        </div>
        {band ? (
          <div style={{ display: "flex", color: OG.amber, fontSize: 24, marginTop: 16 }}>
            {band}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", color: OG.muted, fontSize: 24, letterSpacing: 0.5 }}>
          Ask to join. The host says yes or no.
        </div>
        <div style={{ display: "flex", alignItems: "center", color: OG.coral, fontSize: 26, fontWeight: 700 }}>
          <div style={{ width: 44, height: 2, background: OG.coral, marginRight: 16 }} />
          pubmaxxing.com
        </div>
      </div>
    </CardShell>
  );
}

export default async function Image({ params }: { params: Promise<{ crewId: string }> }) {
  const { crewId } = await params;
  const result = isCrewId(crewId) ? await loadOpenCrawlShareCard(crewId) : null;
  const options = { ...size, fonts: loadOgFonts(), headers: OPEN_CRAWL_OG_HEADERS };
  if (!result?.ok) return new ImageResponse(<Poster />, options);
  return new ImageResponse(<Card card={result.card} />, options);
}
