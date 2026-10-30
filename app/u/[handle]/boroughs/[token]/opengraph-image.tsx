import { ImageResponse } from "next/og";

import { BOROUGH_BINGO_TOTAL, boroughBingoCountLine } from "@/lib/boroughBingo";
import { readBoroughBingoCard } from "@/lib/boroughBingoShare.server";
import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";

// The borough bingo share card (launch review D8). It draws the signed mark
// the owner shared and nothing else: the handle, "11 of 33 boroughs", and 33
// plain squares with that many filled. The squares carry no names, so the card
// never says WHICH boroughs, only how much of London. No rank, no comparison.
// A token that does not verify draws a plain card with no count.

export const runtime = "nodejs";
export const alt = "Borough bingo on PUBMAXX";
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
  const card = await readBoroughBingoCard(handle, decode(token)).catch(() => null);
  const filled = card?.mark ?? 0;
  const title = card ? clampOgText(`@${card.handle}`, 32, "Borough bingo") : "Borough bingo";

  return new ImageResponse(
    (
      <CardShell padding={56}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <Wordmark scale={0.8} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 500, color: OG.muted }}>{title}</div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: OG.ink, lineHeight: 1.05 }}>
            {card ? boroughBingoCountLine(filled) : "London, one borough at a time"}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, width: "100%" }}>
          {Array.from({ length: BOROUGH_BINGO_TOTAL }, (_, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                width: 52,
                height: 52,
                borderRadius: 8,
                background: index < filled ? OG.ink : OG.panelRaised,
                border: `2px solid ${index < filled ? OG.ink : OG.line}`,
              }}
            />
          ))}
        </div>
      </CardShell>
    ),
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
