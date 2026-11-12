import { clampOgText } from "@/lib/ogCardText";
import type { PintReceipt } from "@/lib/pintReceipt";

// The pint receipt as an OG card draws it: the /p/[id] card and the Been card
// (app/u/[handle]/been/[token]) print the same paper. Shared receipt fields come
// from lib/pintReceipt.ts. User text is clamped before it is drawn.

// The receipt's own paper and ink. A card palette belongs to its renderer.
const PAPER = "#f4eee4";
const PAPER_INK = "#17161a";
const PAPER_SOFT = "#5f5a55";
const PAPER_RULE = "#b9b1a6";
const TOOTH = 24;
const RECEIPT_WIDTH = 520;

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

/**
 * A Pint Drop drawn as a till receipt for an `ImageResponse`, tilted and fed
 * from the top of the card. `top` and `left` place it on the caller's card.
 * A null receipt draws the "not on the wall" paper.
 */
export function OgPintReceipt({
  receipt,
  top,
  left,
}: {
  receipt: PintReceipt | null;
  top: number;
  left: number;
}) {
  const venue = clampOgText(receipt?.venueName, 40, "A London pub", { collapseWhitespace: true });
  const drink = clampOgText(receipt?.drink, 26, "", { collapseWhitespace: true });
  const drinker = clampOgText(receipt?.drinker, 24, "", { collapseWhitespace: true });
  const measure = clampOgText(receipt?.measure, 24, "Pint", { collapseWhitespace: true });
  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
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
