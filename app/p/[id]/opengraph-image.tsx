import { ImageResponse } from "next/og";

import { getPintDropById } from "@/lib/pintDropLookup";
import { CrossingMark, OG, OG_CACHE_HEADERS, loadOgFonts } from "@/lib/ogBrand";
import { OgPintReceipt } from "@/lib/ogPintReceipt";
import { buildPintReceipt } from "@/lib/pintReceipt";

// Per-drop share card (Next `opengraph-image` convention): the Pint Drop as a
// till receipt fed out of the top of the card, with the day it was logged set
// large beside it. Shared receipt fields come from lib/pintReceipt.ts, the
// model the permalink prints.
//
// It reads the public DTO (leak-proof: a hidden drop resolves to null and the
// card draws a blank receipt). User text is clamped before it is drawn.

export const runtime = "nodejs";
export const alt = "A pint receipt on PUBMAXX";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = '"Space Grotesk"';

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const drop = await getPintDropById(id).catch(() => null);
  const receipt = drop ? buildPintReceipt(drop) : null;
  // "Tue 10 Nov 2026" set as a torn-off calendar: day, date, year.
  const [weekday, day, month, year] = (receipt?.loggedOn ?? "").split(" ");

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
          fontFamily: font,
        }}
      >
        {/* The till's slot the receipt feeds out of. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 64,
            width: 600,
            height: 14,
            background: OG.inkDeep,
            borderBottom: `2px solid ${OG.line}`,
            display: "flex",
          }}
        />
        <OgPintReceipt receipt={receipt} top={-30} left={96} />

        <div
          style={{
            position: "absolute",
            top: 70,
            right: 80,
            bottom: 64,
            width: 420,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 26, color: OG.muted }}>
              {weekday ? "Logged" : "A Pint Drop"}
            </div>
            {weekday ? (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: OG.inkSoft }}>
                  {weekday}
                </div>
                <div style={{ display: "flex", fontSize: 128, fontWeight: 700, lineHeight: 1 }}>
                  {`${day} ${month}`}
                </div>
                <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: OG.inkSoft }}>
                  {year}
                </div>
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", fontSize: 24, color: OG.muted, lineHeight: 1.3 }}>
              What a drinker paid, logged by the drinker.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 12,
                  background: OG.coral,
                }}
              >
                <CrossingMark ink={OG.inkDeep} size={34} />
              </div>
              <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>pubmaxxing.com</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
