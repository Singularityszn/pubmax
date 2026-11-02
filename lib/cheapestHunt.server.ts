import "server-only";

// The reads behind lib/cheapestHunt.ts, wired once.
//
// The landing and Tonight documents are prerendered (app/page.tsx and
// app/tonight/page.tsx, both force-static), so this runs at build and on their
// regenerations, never per visitor, and both pages share one read. Every read
// here is an existing memoised reader: the London priced index, the UK price
// bundle and the national pub catalogue, which places a base pub inside a city
// on the map by its own point. Nothing is counted again. Hold the promise, not
// the value, so concurrent first renders share one read, and drop it on
// failure so the next render tries again: a failed read renders no claim
// rather than an invented one.

import type { CityId } from "@/lib/cities";
import {
  buildCheapestHunt,
  bundleHuntPints,
  citiesWithUnnamedPints,
  huntCityPints,
  huntPlaceResolver,
  londonHuntPints,
  type CheapestHunt,
  type HuntPint,
} from "@/lib/cheapestHunt";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { getUkNationalPubCatalog } from "@/lib/ukNationalPubSearch.server";
import { getPricedVenues } from "@/lib/venuePriceIndex";

// What a read we could not finish renders: no winner and NO city rows. A city
// row saying "No prices yet" is a claim about the data, and a read that failed
// says nothing about it, so the list stays away rather than word a failed
// read as an empty city.
const UNREAD: CheapestHunt = { britain: null, cities: [], londonDearest: null };

/** Every pint both lanes let stand, and the cities whose prices name no pint. */
type HuntRead = { pints: HuntPint[]; unnamedPriceCities: Set<CityId> };

let cached: Promise<HuntRead | null> | null = null;

async function readHunt(): Promise<HuntRead> {
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
  return {
    pints: [...londonHuntPints(venues, now), ...bundleHuntPints(bundle.byVenue, placeOf, now)],
    unnamedPriceCities: citiesWithUnnamedPints(bundle.byVenue, placeOf, now),
  };
}

/** One read for both readers below; a failed read is dropped so the next render tries again. */
function loadHuntRead(): Promise<HuntRead | null> {
  cached ??= readHunt().catch(() => {
    cached = null;
    return null;
  });
  return cached;
}

export async function loadCheapestHunt(): Promise<CheapestHunt> {
  const read = await loadHuntRead();
  return read ? buildCheapestHunt(read.pints, read.unnamedPriceCities) : UNREAD;
}

/**
 * London's pints that may stand in a "cheapest" line, cheapest first in the
 * hunt's own order (`huntCityPints`). Tonight lists these, so its "Cheapest
 * in London" names the pub the front door's London row names. A failed read
 * answers no rows, never a guess. It never carries London's dearest.
 */
export async function loadLondonHuntPints(): Promise<HuntPint[]> {
  const read = await loadHuntRead();
  return read ? huntCityPints(read.pints, "london") : [];
}
