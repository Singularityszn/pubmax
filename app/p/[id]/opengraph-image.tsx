import { ImageResponse } from "next/og";

import { getPintDropById } from "@/lib/pintDropLookup";
import { CrossingMark, OG, OG_CACHE_HEADERS, loadOgFonts } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { buildPintReceipt, type PintReceipt } from "@/lib/pintReceipt";

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

// The receipt's own paper and ink. A card palette belongs to its renderer.
const PAPER = "#f4eee4";
const PAPER_INK = "#17161a";
const PAPER_SOFT = "#5f5a55";
const PAPER_RULE = "#b9b1a6";
const TOOTH = 24;
const RECEIPT_WIDTH = 520;

const font = '"Space Grotesk"';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        fontSize: strong ? 34 : 24,
        fontWeight: strong ? 700 : 500,
        color: strong ? PAPER_INK : PAPER_SOFT,
      }}
    >
      <div style={{ display: "flex" }}>{label}</div>
      <div style={{ display: "flex", color: PAPER_INK, maxWidth: 380, fontSize: strong ? 58 : 24 }}>
        {value}
      </div>
    </div>
  );
}

function Rule() {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        borderTop: `3px dashed ${PAPER_RULE}`,
        margin: "14px 0",
      }}
    />
  );
}

// The torn bottom edge: a row of paper teeth.
function Teeth() {
  const count = Math.ceil(RECEIPT_WIDTH / TOOTH);
  const points = [`0,0`];
  for (let i = 0; i < count; i += 1) {
    points.push(`${i * TOOTH + TOOTH / 2},${TOOTH / 2}`, `${(i + 1) * TOOTH},0`);
  }
  return (
    <svg width={RECEIPT_WIDTH} height={TOOTH / 2} viewBox={`0 0 ${RECEIPT_WIDTH} ${TOOTH / 2}`}>
      <polygon points={points.join(" ")} fill={PAPER} />
    </svg>
  );
}

function Receipt({ receipt }: { receipt: PintReceipt | null }) {
  const venue = clampOgText(receipt?.venueName, 40, "A London pub", { collapseWhitespace: true });
  const drink = clampOgText(receipt?.drink, 26, "", { collapseWhitespace: true });
  const drinker = clampOgText(receipt?.drinker, 24, "", { collapseWhitespace: true });
  const measure = clampOgText(receipt?.measure, 24, "Pint", { collapseWhitespace: true });
  return (
    <div
      style={{
        position: "absolute",
        top: -30,
        left: 96,
        display: "flex",
        flexDirection: "column",
        width: RECEIPT_WIDTH,
        transform: "rotate(-2.5deg)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: PAPER,
          color: PAPER_INK,
          padding: "56px 40px 30px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, letterSpacing: 6 }}>
            PUBMAXX
          </div>
          <div style={{ display: "flex", fontSize: 20, color: PAPER_SOFT, marginTop: 4 }}>
            Pint receipt
          </div>
          <div
            style={{
              display: "flex",
              textAlign: "center",
              fontSize: venue.length > 20 ? 36 : 46,
              fontWeight: 700,
              lineHeight: 1.08,
              marginTop: 14,
            }}
          >
            {venue}
          </div>
        </div>
        <Rule />
        {receipt ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row label={`1 × ${measure}`} value={receipt.price ?? ""} />
            {drink ? (
              <div style={{ display: "flex", fontSize: 25, color: PAPER_SOFT }}>{drink}</div>
            ) : null}
            <Rule />
            {receipt.price ? <Row label="Paid" value={receipt.price} strong /> : null}
            {drinker ? <Row label="Drinker" value={drinker} /> : null}
            {receipt.bill ? <Row label="Price" value={receipt.bill} /> : null}
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 24, color: PAPER_SOFT }}>
            This pint isn&rsquo;t on the wall.
          </div>
        )}
      </div>
      <Teeth />
    </div>
  );
}

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
        <Receipt receipt={receipt} />

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
