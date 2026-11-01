import type { Metadata } from "next";

import {
  areaPlacePhoto,
  londonPlacePhoto,
  pubPlacePhoto,
  type PlacePhoto,
} from "@/components/listing/placePhotoRules";
import { venueCheapestPintObservedAt } from "@/lib/drinks";
import { loadHistoricPubs } from "@/lib/historic";
import { hypedPubPriceIndex, hypedPubsForPage } from "@/lib/hypedPubs";
import { loadHypedPubs } from "@/lib/hypedPubs.server";
import { loadMapSelectableVenueIds } from "@/lib/mapEagerVenueIndex.server";
import { LONDON_NIGHT_AREA_SLUGS } from "@/lib/nightAreaSlugs";
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
import { loadTonightOperatorFacts } from "@/lib/tonightOperatorFacts.server";
import TonightClient from "./TonightClient";
import { initialTonightOutAnswer } from "./initialOutAnswer";

// The server composes the public listing answer through the same readers as
// Today. The browser revalidates it through the shared map and Out API readers.
const title = "Tonight in London";
const description =
  "Check sourced London pub listings for tonight on PUBMAXX, with map links when available.";
const image = "/tonight/opengraph-image";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/tonight" },
  openGraph: {
    title,
    description,
    type: "website",
    url: "/tonight",
    images: [{ url: image, width: 1200, height: 630, alt: "What's on in London tonight. PUBMAXX" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
  },
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

// The photographs this page may show, resolved here so neither photograph
// table reaches the browser (components/listing/placePhotoRules.ts). A pub's own
// photograph is kept only for a pub this page recommends, matched by venue id.
// The area photographs are every Night Area we hold one of, because the area
// the reader is in is only known after load; London's stands for the page
// when no area is known.
function tonightPhotos(hypedVenueIds: readonly (string | null)[]): {
  pubPhotos: Record<string, PlacePhoto>;
  areaPhotos: Record<string, PlacePhoto>;
  londonPhoto: PlacePhoto | null;
} {
  const pubPhotos: Record<string, PlacePhoto> = {};
  for (const venueId of hypedVenueIds) {
    const photo = venueId ? pubPlacePhoto(venueId) : null;
    if (venueId && photo) pubPhotos[venueId] = photo;
  }
  const areaPhotos: Record<string, PlacePhoto> = {};
  for (const slug of LONDON_NIGHT_AREA_SLUGS) {
    const photo = areaPlacePhoto(slug);
    if (photo) areaPhotos[slug] = photo;
  }
  return { pubPhotos, areaPhotos, londonPhoto: londonPlacePhoto() };
}

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
    whatsOn,
    out,
    operatorFacts,
  ] =
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
      // What the pubs themselves published for tonight (operator facts). Read
      // here so the block costs the reader no request; it never joins the
      // listings and never leads (TonightFromThePubs).
      loadTonightOperatorFacts(now.getTime()),
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

  // Fresh rows only, measured on this render's clock, each carrying the
  // cheapest pint we list there off the same dataset as the cheap pints.
  const hypedPubs = hypedPubsForPage(hyped.rows, {
    now,
    prices: hypedPubPriceIndex(
      pricedVenues.map((venue) => ({
        id: venue.id,
        cheapestPrice: venue.cheapestPrice,
        observedAt: venueCheapestPintObservedAt(venue),
      })),
    ),
  });

  return (
    <TonightClient
      initialListings={{
        whatsOn,
        out: initialTonightOutAnswer(out, now.getTime()),
        renderedAt: now.getTime(),
      }}
      quietPint={quietPint}
      softPlansWindow={softPlansWindow}
      mapSelectableVenueIds={
        mapSelectableVenueIds ? [...mapSelectableVenueIds] : null
      }
      hypedPubs={hypedPubs}
      operatorFacts={operatorFacts}
      photos={tonightPhotos(hypedPubs.map((row) => row.venueId))}
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
