import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import {
  CardShell,
  OG,
  OG_CACHE_HEADERS,
  OG_SIZE,
  Wordmark,
  loadOgFonts,
  priceStamp,
} from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { formatSavedVenueCount } from "@/lib/savedListPresentation";
import { readPublicSavedList, savedListCardPubs } from "@/lib/savedListShare.server";

// The share card for one saved list: its name, how many pubs it holds, whose
// it is, and up to five pub names each with the plaque figure the map prints
// for it. It reads the same seam as the page (lib/savedListShare.server.ts),
// so a private account's list is the same 404 here as there, and a pub with no
// listed price carries no plaque rather than an invented one.

export const runtime = "nodejs";
export const alt = "A saved list of pubs on PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

type ImageProps = { params: Promise<{ handle: string; listType: string }> };

function Plaque({ price }: { price: string }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "6px 16px",
        borderRadius: 999,
        background: OG.amber,
        color: OG.inkDeep,
        fontSize: 28,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {price}
    </div>
  );
}

export default async function Image({ params }: ImageProps) {
  const { handle, listType: rawListType } = await params;
  const read = await readPublicSavedList(handle, rawListType);
  if (read.status === "hidden") notFound();

  const owner = clampOgText(read.status === "ok" ? read.ownerHandle : "", 32, "someone");
  const listName = clampOgText(read.status === "ok" ? read.listType : "", 48, "Saved list");
  const venues = read.status === "ok" ? read.venues : [];
  const pubs = await savedListCardPubs(venues);
  const titleSize = listName.length > 28 ? 56 : listName.length > 16 ? 68 : 82;

  return new ImageResponse(
    (
      <CardShell>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <Wordmark scale={0.8} />
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
            Saved list
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          <div
            style={{
              display: "flex",
              fontSize: titleSize,
              fontWeight: 700,
              letterSpacing: -1,
              lineHeight: 1.0,
              color: OG.ink,
            }}
          >
            {listName}
          </div>
          <div style={{ display: "flex", fontSize: 28, color: OG.inkSoft, marginTop: 14 }}>
            {`@${owner} · ${formatSavedVenueCount(venues.length)}`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 26, gap: 10 }}>
            {pubs.map((pub) => {
              const price = priceStamp(pub.priceGbp);
              return (
                <div
                  key={pub.venueId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 24,
                    paddingBottom: 8,
                    borderBottom: `1px solid ${OG.line}`,
                  }}
                >
                  <div style={{ display: "flex", fontSize: 30, fontWeight: 500, color: OG.ink }}>
                    {clampOgText(pub.name, 44, "A pub")}
                  </div>
                  {price ? <Plaque price={price} /> : null}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 22, color: OG.muted }}>
          pubmaxxing.com
        </div>
      </CardShell>
    ),
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
