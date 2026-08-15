import { ImageResponse } from "next/og";

import { loadNightAreaLanding } from "@/lib/nightAreaLanding.server";
import {
  CardShell,
  OG,
  OG_SIZE,
  Wordmark,
  clampText,
  priceStamp,
} from "@/lib/ogBrand";

export const runtime = "nodejs";
export const alt = "Listed cheapest pints in this London area. PUBMAXXING";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const landing = await loadNightAreaLanding(slug);
  const name = clampText(landing?.name, 24, "London");
  const cheapest = priceStamp(landing?.prices[0]?.priceGbp ?? null);
  const count = landing?.pricedPubCount ?? 0;

  return new ImageResponse(
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <Wordmark />
        <div style={{ display: "flex", color: OG.coral, fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>
          Pint prices
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", color: OG.muted, fontSize: 26, letterSpacing: 6, textTransform: "uppercase", marginBottom: 14 }}>
          Cheapest listed pint in
        </div>
        <div style={{ display: "flex", color: OG.ink, fontSize: name.length > 16 ? 68 : 88, fontWeight: 700, letterSpacing: -2, lineHeight: 1 }}>
          {name}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 42, marginTop: 38 }}>
          <div style={{ display: "flex", color: OG.coral, fontSize: 176, fontWeight: 700, letterSpacing: -5, lineHeight: 0.85 }}>
            {cheapest ?? "Prices checked"}
          </div>
          {count > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", padding: "20px 28px", border: `1px solid ${OG.line}`, borderRadius: 18, background: OG.panelRaised }}>
              <div style={{ display: "flex", color: OG.ink, fontSize: 52, fontWeight: 700, lineHeight: 1 }}>{count}</div>
              <div style={{ display: "flex", color: OG.muted, fontSize: 22, marginTop: 10 }}>priced pubs</div>
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", color: OG.muted, fontSize: 21 }}>
        <div style={{ display: "flex" }}>Publisher named beside every listed price</div>
        <div style={{ display: "flex", color: OG.inkSoft }}>pubmaxxing.com/area/{slug}</div>
      </div>
    </CardShell>,
    size,
  );
}
