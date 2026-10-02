import { headers } from "next/headers";
import { ImageResponse } from "next/og";

import { buildBarTab, normalizePintDrop, type PintDropDTO } from "@/lib/feed";
import {
  CardShell,
  OG,
  OG_SIZE,
  Wordmark,
  loadOgFonts,
  priceStamp,
} from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import { isSupabaseConfigured } from "@/lib/supabase";
import { memoryPintDropStore, supabasePintDropStore } from "@/lib/pintDropsStore";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import type { Venue } from "@/lib/venues";

// Per-venue Bar Tab OG share card (Next `opengraph-image` convention) — the
// last shared night-object URL that had no card (WhatsApp-native share
// artifacts, Cycle 2 decision 5). Renders the venue's tab headline on the
// dark elevation ladder: the cheapest pint dropped on the tab as the coral
// hero figure, plus how many pints are on the tab. Provenance-honest: both
// numbers come from the SAME public listVisible read the page renders (issue
// #29 visibility applied server-side), so the card can never show a pint the
// page would hide — and a tab with no priced drops shows no figure at all.
// An unknown id, and a read we could not run, degrade to a clean generic
// poster rather than throwing.
//
// runtime = "nodejs": the venue dataset and the Space Grotesk fonts are read
// from the filesystem via node:fs (edge-incompatible). Matches the sibling
// OG routes.

export const runtime = "nodejs";
export const alt = "Recent pints dropped at this London pub. PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

// The same lookup the Bar Tab page uses. Never throws: a missing id or a read
// we could not run yields null, and the card renders the generic poster.
// Next stores a generated opengraph image unless the handler reads a request
// API, and this route does not run the layout that opts the Bar Tab document
// out. A missing id is a stable answer, so that poster may be stored. A read
// we could not run calls headers() first, the same opt-out the page uses, so
// only a found card can be stored.
async function getVenue(id: string): Promise<Venue | null> {
  try {
    const read = await lookupVenueDetail(id);
    if (read.status === "found") return read.venue;
    if (read.status === "missing") return null;
  } catch {
    await headers();
    return null;
  }
  await headers();
  return null;
}

// The same public read the page makes — anonymous surface, visibility applied.
async function loadBarTab(venueId: string) {
  try {
    const store = isSupabaseConfigured() ? supabasePintDropStore : memoryPintDropStore;
    const drops = await store.listVisible(venueId);
    return buildBarTab((drops as PintDropDTO[]).map(normalizePintDrop));
  } catch {
    return { tileCount: 0, cheapestGbp: null };
  }
}

// A raised stat tile: a value over a muted label, on a panel step above the
// page (mirrors the borough card).
function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minWidth: 210,
        padding: "22px 30px",
        borderRadius: 18,
        background: OG.panelRaised,
        border: `1px solid ${OG.line}`,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 54,
          fontWeight: 700,
          color: OG.ink,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 22,
          color: OG.muted,
          marginTop: 12,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const venue = await getVenue(id);
  const barTab = venue ? await loadBarTab(venue.id) : { tileCount: 0, cheapestGbp: null };

  const name = clampOgText(venue?.name, 36, "A London pub", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  const borough = clampOgText(venue?.primaryBorough, 28, "London", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  const cheapest = priceStamp(barTab.cheapestGbp);
  const pintCount = barTab.tileCount;

  // Venue name scales down as it gets longer so it never collides with the
  // frame ("The Princess Louise", "The Cittie of Yorke").
  const nameSize = name.length > 24 ? 60 : name.length > 16 ? 72 : 86;

  return new ImageResponse(
    (
      <CardShell>
        {/* Header: wordmark lockup + edition kicker */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <Wordmark />
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
            The Bar Tab
          </div>
        </div>

        {/* Middle: eyebrow → venue name → the hero figure + stat tile */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              color: OG.muted,
              fontSize: 26,
              fontWeight: 500,
              letterSpacing: 6,
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Recent pints dropped at
          </div>
          <div
            style={{
              display: "flex",
              fontSize: nameSize,
              fontWeight: 700,
              letterSpacing: -1,
              lineHeight: 1.0,
              color: OG.ink,
            }}
          >
            {name}
          </div>

          {cheapest ? (
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                marginTop: 30,
                width: "100%",
              }}
            >
              {/* The cheapest pint on the tab — the one hero number */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 170,
                    fontWeight: 700,
                    lineHeight: 0.9,
                    letterSpacing: -4,
                    color: OG.coral,
                  }}
                >
                  {cheapest}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 24,
                    color: OG.inkSoft,
                    marginTop: 14,
                    letterSpacing: 1,
                  }}
                >
                  the cheapest pint on the tab
                </div>
              </div>

              <div style={{ display: "flex", gap: 18, marginBottom: 6 }}>
                <StatTile
                  value={String(pintCount)}
                  label={pintCount === 1 ? "pint on the tab" : "pints on the tab"}
                />
              </div>
            </div>
          ) : (
            // No priced drops (or unknown id): honest, no invented figure.
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 34,
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 40,
                  fontWeight: 700,
                  color: OG.inkSoft,
                }}
              >
                {pintCount > 0
                  ? `${pintCount} ${pintCount === 1 ? "pint" : "pints"} on the tab`
                  : "The tab is open"}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 26,
                  color: OG.muted,
                  marginTop: 14,
                }}
              >
                Photos, prices, and the stories behind them.
              </div>
            </div>
          )}
        </div>

        {/* Footer: borough + URL joined by the coral rule */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              color: OG.muted,
              fontSize: 24,
              letterSpacing: 0.5,
            }}
          >
            {borough} · pints as they were poured
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: OG.coral,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                width: 44,
                height: 2,
                background: OG.coral,
                marginRight: 16,
              }}
            />
            pubmaxxing.com
          </div>
        </div>
      </CardShell>
    ),
    { ...size, fonts: loadOgFonts() },
  );
}
