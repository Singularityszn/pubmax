import type { Metadata } from "next";

import { venueCheapestPintObservedAt } from "@/lib/drinks";
import { loadHistoricPubs } from "@/lib/historic";
import { hypedPubsForPage } from "@/lib/hypedPubs";
import { loadHypedPubs } from "@/lib/hypedPubs.server";
import { loadMapSelectableVenueIds } from "@/lib/mapEagerVenueIndex.server";
import { buildQuietPint, isQuietPintWindow } from "@/lib/quietPint";
import { readSpoonsValue } from "@/lib/spoonsValue.server";
import {
  tonightCheapPintChain,
  tonightCheapPints,
  tonightWetherspoonVenueIds,
} from "@/lib/tonightCheapPints";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import { resolveTonightConditions } from "@/lib/tonightConditionsRoute";
import { matchedWetherspoonsVenueIds } from "@/lib/wetherspoonsMatch.server";
import TonightClient from "./TonightClient";

// First-class "Tonight" screen. The client owns the PRIMARY What's-On spine
// (/api/whats-on — same as the map Tonight lane) and all interactivity. This
// server shell carries route metadata plus the quiet-pint module when the
// typical-pattern hour allows it (same buildQuietPint seam as /today).
export const metadata: Metadata = {
  title: "Tonight in London · PUBMAXXING",
  description:
    "Check sourced London pub listings for tonight on PubMaxxing, with map links when available.",
  alternates: { canonical: "/tonight" },
};

export const runtime = "nodejs";

// THIS DOCUMENT IS PRERENDERED (captain 2026-09-05, "Widen", recorded in
// proxy.ts beside CDN_CACHED_DOCUMENT_PATHS): it drops the per-request CSP
// nonce so the Vercel CDN can hold it. Two rules follow, both enforced by
// `__tests__/cdnCachedDocuments.test.ts`:
//
//   1. Nothing per-request may be read here. `force-static` makes that a build
//      error rather than a silent per-request render, and it is also what stops
//      the root layout's nonce read (`headers()`) from pulling this route back
//      into dynamic rendering. The remembered area and every query parameter
//      are read by the client after load.
//   2. Nothing personal may reach this document. One prerendered copy is handed
//      to every stranger, and the What's-On spine is fetched by the client.
export const dynamic = "force-static";
// The London clock and public weather reading can move between deploys.
// Five minutes bounds how far a held copy can lag a window boundary. The CDN
// regenerates in the background so no reader waits for it.
export const revalidate = 300;

export default async function TonightPage() {
  const now = new Date();
  const softPlansWindow = isQuietPintWindow(now);

  // Same fail-soft compose as /today: heritage-cited candidates joined to
  // verified pint prices. buildQuietPint returns null outside a quiet window
  // or when cited candidates are too few; the card then renders nothing.
  const [
    pricedVenues,
    historicPubs,
    mapSelectableVenueIds,
    hyped,
    spoonsValue,
    initialConditionsSummary,
  ] = await Promise.all([
    getPricedVenues(),
    loadHistoricPubs(),
    loadMapSelectableVenueIds(),
    // The pubs people are talking about. Read here rather than in the browser:
    // this document is prerendered, so the rows cost the reader no request and
    // the route's byte ceiling is untouched.
    loadHypedPubs(),
    // Read on the server for the chain cap alone; no row of it reaches the
    // document.
    readSpoonsValue(),
    // A public London reading paints before the listings. Location stays
    // client-owned, and the strip refreshes through the same API resolver.
    resolveTonightConditions({ point: null, now }).catch(() => null),
  ]);
  // One row per chain in the cheapest list. The first-party Wetherspoon
  // directory join and the SpoonMe pack name a Wetherspoon the price listing
  // never labelled, and a pub the directory dropped still counts.
  const wetherspoonVenueIds = tonightWetherspoonVenueIds(
    await matchedWetherspoonsVenueIds(
      pricedVenues.map((venue) => ({
        id: venue.id,
        name: venue.name,
        lat: venue.latitude,
        lng: venue.longitude,
      })),
    ),
    new Set(spoonsValue.byVenueId.keys()),
  );
  const priceById = new Map<string, number>();
  for (const venue of pricedVenues) {
    if (typeof venue.cheapestPrice === "number") priceById.set(venue.id, venue.cheapestPrice);
  }
  const quietPint = buildQuietPint({
    candidates: historicPubs.flatMap((pub) =>
      pub.venueId
        ? [
            {
              venueId: pub.venueId,
              name: pub.name,
              slug: pub.slug,
              hook: pub.hook,
              facts: pub.facts,
              era: pub.era,
              dateLabel: pub.dateLabel,
              listed: pub.listed,
            },
          ]
        : [],
    ),
    priceById,
    now,
  });

  return (
    <TonightClient
      quietPint={quietPint}
      softPlansWindow={softPlansWindow}
      initialConditionsSummary={initialConditionsSummary}
      mapSelectableVenueIds={
        mapSelectableVenueIds ? [...mapSelectableVenueIds] : null
      }
      hypedPubs={hypedPubsForPage(hyped.rows)}
      // What a quiet night answers with: real pubs at a listed price, composed
      // from the dataset this page already read for the quiet-pint module.
      cheapPints={tonightCheapPints(
        pricedVenues.map((venue) => ({
          id: venue.id,
          name: venue.name,
          primaryBorough: venue.primaryBorough,
          cheapestPrice: venue.cheapestPrice,
          observedAt: venueCheapestPintObservedAt(venue),
          chain: tonightCheapPintChain(venue, wetherspoonVenueIds),
        })),
      )}
    />
  );
}
