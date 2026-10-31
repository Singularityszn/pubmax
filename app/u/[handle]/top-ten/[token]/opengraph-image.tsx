import { ImageResponse } from "next/og";

import { readTopTenCard } from "@/lib/passportTopTenCard.server";
import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { priceBandLabel, type PriceBand } from "@/lib/priceBand";
import { topTenTitle } from "@/lib/profilePassport";

// The top-ten share card. It draws the signed list the owner shared and
// nothing else: ten names in their order, each with the band of its listed
// pint as a word on a coloured plaque. No score, no price figure, no number
// but the place. A token that does not verify draws a plain card with no list.

export const runtime = "nodejs";
export const alt = "A top ten on PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

// The OG renderer cannot read CSS tokens, so the band hues are the dark
// theme's --pint, --amber and --brick (app/theme.css), the same three the
// price-band tokens point at.
const BAND_HUE: Record<PriceBand, string> = {
  cheap: "#5fb389",
  average: "#f0a01a",
  expensive: "#d47a82",
};

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
  const card = await readTopTenCard(handle, decode(token)).catch(() => null);
  const title = clampOgText(card ? topTenTitle(card.handle) : "A top ten", 48, "A top ten");
  const rows = card?.rows ?? [];
  const columns = [rows.slice(0, 5), rows.slice(5, 10)].filter((column) => column.length);

  return new ImageResponse(
    (
      <CardShell padding={56}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <Wordmark scale={0.8} />
        </div>
        <div style={{ display: "flex", fontSize: 46, fontWeight: 700, color: OG.ink, lineHeight: 1.1 }}>
          {title}
        </div>
        <div style={{ display: "flex", gap: 40, width: "100%" }}>
          {columns.map((column, columnIndex) => (
            <div key={columnIndex} style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minWidth: 0 }}>
              {column.map((row) => (
                <div key={row.venueId} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ display: "flex", width: 40, fontSize: 28, fontWeight: 700, color: OG.muted }}>
                    {String(row.place)}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flex: 1,
                      minWidth: 0,
                      fontSize: 28,
                      fontWeight: 500,
                      color: OG.ink,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {clampOgText(row.venueName, 26, "A London pub", { collapseWhitespace: true })}
                  </div>
                  {row.band ? (
                    <div
                      style={{
                        display: "flex",
                        fontSize: 18,
                        fontWeight: 700,
                        color: OG.inkDeep,
                        background: BAND_HUE[row.band],
                        borderRadius: 999,
                        padding: "4px 12px",
                      }}
                    >
                      {priceBandLabel(row.band)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardShell>
    ),
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
