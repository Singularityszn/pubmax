import type { Metadata } from "next";

import { venueCheapestPintObservedAt } from "@/lib/drinks";
import { loadHistoricPubs } from "@/lib/historic";
import { hypedPubPriceIndex, hypedPubsForPage } from "@/lib/hypedPubs";
import { loadHypedPubs } from "@/lib/hypedPubs.server";
import { loadMapSelectableVenueIds } from "@/lib/mapEagerVenueIndex.server";
import { buildQuietPint, isQuietPintWindow } from "@/lib/quietPint";
import { loadTodayOutAnswer, loadTodayWhatsOnAnswer } from "@/lib/todayListings.server";
import { readSpoonsValue } from "@/lib/spoonsValue.server";
import {
  tonightCheapPintChain,
  tonightCheapPints,
  tonightWetherspoonVenueIds,
} from "@/lib/tonightCheapPints";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import { matchedWetherspoonsVenueIds } from "@/lib/wetherspoonsMatch.server";
import TonightClient from "./TonightClient";

// The server composes the public listing answer through the same readers as
// Today. The browser revalidates it through the shared map and Out API readers.
export const metadata: Metadata = {
  title: "Tonight in London · PUBMAXX",
  description:
    "Check sourced London pub listings for tonight on PUBMAXX, with map links when available.",
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
//      to every stranger. The browser revalidates the public listings.
export const dynamic = "force-static";
// The one input that moves between deploys is the London clock: the quiet-pint
// window and the soft-plans window both read the hour. Five minutes bounds how
// far a held copy can lag a window boundary, and the CDN regenerates in the
// background so no reader waits for it.
export const revalidate = 300;

export default async function TonightPage() {
  const now = new Date();
  const softPlansWindow = isQuietPintWindow(now);

  // Same fail-soft compose as /today: heritage-cited candidates joined to
  // verified pint prices. buildQuietPint returns null outside a quiet window
  // or when cited candidates are too few; the card then renders nothing.
  const [pricedVenues, historicPubs, mapSelectableVenueIds, hyped, spoonsValue, whatsOn, out] =
    await Promise.all([
      getPricedVenues(),
      loadHistoricPubs(),
      loadMapSelectableVenueIds(),
      // The pubs Londoners keep recommending. Read here rather than in the browser:
      // this document is prerendered, so the rows cost the reader no request and
      // the route's byte ceiling is untouched.
      loadHypedPubs(),
      // Read on the server for the chain cap alone; no row of it reaches the
      // document.
      readSpoonsValue(),
      loadTodayWhatsOnAnswer(now.getTime(), { pubOnly: true, limit: 60 }),
      loadTodayOutAnswer(now.getTime()),
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
      initialListings={{ whatsOn, out, renderedAt: now.getTime() }}
      quietPint={quietPint}
      softPlansWindow={softPlansWindow}
      mapSelectableVenueIds={
        mapSelectableVenueIds ? [...mapSelectableVenueIds] : null
      }
      // Fresh rows only, measured on this render's clock, each carrying the
      // cheapest pint we list there off the same dataset as the cheap pints.
      hypedPubs={hypedPubsForPage(hyped.rows, {
        now,
        prices: hypedPubPriceIndex(
          pricedVenues.map((venue) => ({
            id: venue.id,
            cheapestPrice: venue.cheapestPrice,
            observedAt: venueCheapestPintObservedAt(venue),
          })),
        ),
      })}
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
