import { ImageResponse } from "next/og";

import { BEEN_CARD_COPY, beenCardCountLine, beenCardDay } from "@/lib/beenCard";
import { readBeenCard } from "@/lib/beenCardShare.server";
import { OG, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { OgPintReceipt } from "@/lib/ogPintReceipt";

// The Been card share image. It draws the signed count with the day it was
// counted, and the cheapest pint as the same receipt paper the /p/[id] card
// prints, while that drop still stands. No pub from the Been list, no rank.
// A token that does not verify draws a plain card with no count.

export const runtime = "nodejs";
export const alt = "A Been card on PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

type ImageProps = { params: Promise<{ handle: string; token: string }> };

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function Image({ params }: ImageProps) {
  const { handle, token } = await params;
  const card = await readBeenCard(handle, decode(token)).catch(() => null);
  const receipt = card?.receipt ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: `linear-gradient(160deg, ${OG.panel} 0%, ${OG.inkDeep} 100%)`,
          color: OG.ink,
          fontFamily: '"Space Grotesk"',
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 64,
            left: 72,
            bottom: 64,
            width: receipt ? 500 : 1056,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <Wordmark scale={0.8} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 500, color: OG.muted }}>
              {card ? clampOgText(`@${card.handle}`, 24, BEEN_CARD_COPY.kicker) : BEEN_CARD_COPY.kicker}
            </div>
            {card ? <div style={{ display: "flex", fontSize: 30, color: OG.inkSoft }}>has been to</div> : null}
            <div style={{ display: "flex", fontSize: card ? 112 : 72, fontWeight: 700, lineHeight: 1.05 }}>
              {card ? beenCardCountLine(card.pubs) : "London, one pub at a time"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {card ? (
              <div style={{ display: "flex", fontSize: 24, color: OG.muted, lineHeight: 1.3 }}>
                {`Counted on ${beenCardDay(card.issuedAt)}`}
              </div>
            ) : null}
            {receipt ? (
              <div style={{ display: "flex", fontSize: 24, color: OG.muted }}>
                {`${BEEN_CARD_COPY.cheapestLabel}${receipt.loggedOn ? ` · Logged ${receipt.loggedOn}` : ""}`}
              </div>
            ) : null}
          </div>
        </div>
        {receipt ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 600,
              width: 600,
              height: 14,
              background: OG.inkDeep,
              borderBottom: `2px solid ${OG.line}`,
              display: "flex",
            }}
          />
        ) : null}
        {receipt ? <OgPintReceipt receipt={receipt} top={-30} left={640} /> : null}
      </div>
    ),
    { ...size, fonts: loadOgFonts(), headers: { "Cache-Control": "private, no-store" } },
  );
}
