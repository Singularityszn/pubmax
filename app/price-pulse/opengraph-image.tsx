import { ImageResponse } from "next/og";

import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts } from "@/lib/ogBrand";
import { EXAMPLE_PINT_LABEL, formatPintMoney, splitPintPrice } from "@/lib/pricePulseExplainer";

export const runtime = "nodejs";
export const alt = "Price Pulse: where the money in a £6 pint goes · PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

// The card carries the explainer, never an edition: an edition is a draft until
// the owner approves it, and a share card must not leak one before then. The
// figures are the same computed split the page prints.
export default async function Image() {
  const split = splitPintPrice();
  const line = `VAT ${formatPintMoney(split.vatGbp)} · Duty ${formatPintMoney(split.dutyGbp)} · Everything else ${formatPintMoney(split.restGbp)}`;
  return new ImageResponse(
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <Wordmark />
        <div style={{ display: "flex", color: OG.coral, fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>Price Pulse</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 1000 }}>
        <div style={{ display: "flex", color: OG.ink, fontSize: 82, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
          {`Where your ${EXAMPLE_PINT_LABEL} goes`}
        </div>
        <div style={{ display: "flex", color: OG.inkSoft, fontSize: 32, lineHeight: 1.35, marginTop: 26 }}>{line}</div>
        <div style={{ display: "flex", color: OG.muted, fontSize: 26, lineHeight: 1.35, marginTop: 14 }}>
          What people are saying about pint prices, with a source and a date on every line.
        </div>
      </div>
      <div style={{ display: "flex", color: OG.muted, fontSize: 21 }}>pubmaxxing.com/price-pulse</div>
    </CardShell>,
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
