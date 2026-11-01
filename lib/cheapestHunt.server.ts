import "server-only";

// The reads behind lib/cheapestHunt.ts, wired once.
//
// The landing document is prerendered (app/page.tsx, force-static), so this
// runs at build and on each hourly regeneration, never per visitor. Every read
// here is an existing memoised reader: the London priced index, the UK price
// bundle and the national pub catalogue, which places a base pub inside a city
// on the map by its own point. Nothing is counted again. Hold the promise, not
// the value, so concurrent first renders share one read, and drop it on
// failure so the next render tries again: a failed read renders no claim
// rather than an invented one.

import {
  buildCheapestHunt,
  bundleHuntPints,
  citiesWithUnnamedPints,
  huntPlaceResolver,
  londonHuntPints,
  type CheapestHunt,
} from "@/lib/cheapestHunt";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { getUkNationalPubCatalog } from "@/lib/ukNationalPubSearch.server";
import { getPricedVenues } from "@/lib/venuePriceIndex";

// What a read we could not finish renders: no winner and NO city rows. A city
// row saying "No prices yet" is a claim about the data, and a read that failed
// says nothing about it, so the list stays away rather than word a failed
// read as an empty city.
const UNREAD: CheapestHunt = { britain: null, cities: [], londonDearest: null };

let cached: Promise<CheapestHunt> | null = null;

async function readCheapestHunt(): Promise<CheapestHunt> {
  const now = Date.now();
  const [venues, bundle] = await Promise.all([getPricedVenues(), ukPriceBundleRowsByVenue()]);
  const catalog = getUkNationalPubCatalog();
  if (venues.length === 0 || bundle.status === "unavailable" || catalog.status !== "ready") {
    throw new Error("a hunt read is unavailable");
  }
  const basePubs = new Map(
    catalog.pubs
      .filter((pub) => !pub.closed)
      .map((pub) => [pub.id, { name: pub.name, address: pub.address, lat: pub.lat, lng: pub.lng }] as const),
  );
  const placeOf = huntPlaceResolver({
    londonPubs: new Map(
      venues.map((venue) => [venue.id, { name: venue.name, address: venue.address }] as const),
    ),
    basePubs,
  });
  return buildCheapestHunt(
    [...londonHuntPints(venues, now), ...bundleHuntPints(bundle.byVenue, placeOf, now)],
    citiesWithUnnamedPints(bundle.byVenue, placeOf, now),
  );
}

export function loadCheapestHunt(): Promise<CheapestHunt> {
  cached ??= readCheapestHunt().catch(() => {
    cached = null;
    return UNREAD;
  });
  return cached;
}
