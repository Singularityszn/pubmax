import { ImageResponse } from "next/og";
import { loadGuinnessIndex } from "@/lib/guinnessIndex.server";
import { CardShell, OG, OG_CACHE_HEADERS, OG_SIZE, Wordmark, loadOgFonts, priceStamp } from "@/lib/ogBrand";

export const runtime = "nodejs";
export const alt = "London Guinness index. PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const index = await loadGuinnessIndex();
  return new ImageResponse(<CardShell>
    <Wordmark />
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", color: OG.inkSoft, fontSize: 36 }}>London Guinness index</div>
      {index.medianGbp !== null ? <>
        <div style={{ display: "flex", color: OG.coral, fontSize: 150, fontWeight: 700 }}>{priceStamp(index.medianGbp)}</div>
        <div style={{ display: "flex", color: OG.ink, fontSize: 30 }}>Median listed pint · {index.count} venues</div>
      </> : <div style={{ display: "flex", color: OG.ink, fontSize: 50 }}>Not enough listed prices yet</div>}
    </div>
    <div style={{ display: "flex", flexDirection: "column", color: OG.inkSoft, fontSize: 22 }}>
      {index.oldest && <div style={{ display: "flex" }}>Sources: {index.sources.join(", ")} · {index.oldest}{index.oldest !== index.newest ? ` to ${index.newest}` : ""}</div>}
      <div style={{ display: "flex" }}>Prices may have changed · pubmaxxing.com/guinness-index</div>
    </div>
  </CardShell>, { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS });
}
