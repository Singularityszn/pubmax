// THE ONE ANSWER TO "HOW MANY LONDON PUBS HAVE A PINT PRICE" (launch review,
// 30 Oct 2026, section 3.2). The landing and /about printed 942 priced pubs
// while /pint-index printed 960 of 2,034. Both were honest and neither said its
// base: 942 counted every VENUE in the app dataset (a few are not pubs) with a
// listed pint, and 960 counted PUBS in that list with a pint from any source we
// show (the listed price, a published menu or a drinker's update).
//
// Every page now reads this module and names its base in these words:
//
//   - `pricedPubCount` answers how many pubs are in OUR LONDON PUB LIST and how
//     many of them have a pint price on record, from any source. It needs the
//     menu and update packs, so it is read by the dynamic pages (/about,
//     /pint-index), never by the prerendered landing.
//   - `listedPriceCohort` is the set an AVERAGE is taken over: each pub in the
//     same list that carries its own listed cheapest pint. A menu row or a
//     drinker's update has no "cheapest pint" of the pub, so it stays out of
//     the average, and the sentence says so by naming the narrower base.
//
// Pure: no I/O. `lib/pricedPubCount.server.ts` wires the real packs.

import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { listedDrinkCoverage, type ListedDrinkCoverage } from "@/lib/listedDrinkCoverage";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import { PUB_LIST_BASE } from "@/lib/pubListBase";

export { averageBasePhrase, PUB_LIST_BASE } from "@/lib/pubListBase";

export type PricedPubCount = {
  /** Pubs in our London pub list. */
  listPubs: number;
  /** Of those, pubs with a pint price on record from any source we show. */
  pricedPubs: number;
};

export function pricedPubCount(
  venues: readonly Venue[],
  updates: readonly DrinkPriceUpdate[],
  bundleByVenue: ReadonlyMap<string, readonly UkPriceBundleRow[]> = new Map(),
  now: number = Date.now(),
): PricedPubCount {
  return pricedPubCountFromCoverage(listedDrinkCoverage(venues, updates, bundleByVenue, now));
}

/** The same answer, read off a coverage the caller already holds. */
export function pricedPubCountFromCoverage(coverage: ListedDrinkCoverage): PricedPubCount {
  return { listPubs: coverage.total, pricedPubs: coverage.pricedPubs };
}

/** The pubs an average is taken over: pubs in the list with a listed cheapest pint. */
export function listedPriceCohort<T extends Pick<Venue, "kind" | "cheapestPrice">>(
  venues: readonly T[],
): T[] {
  return venues.filter(
    (venue) =>
      isPubVenueKind(venue.kind) &&
      typeof venue.cheapestPrice === "number" &&
      Number.isFinite(venue.cheapestPrice) &&
      venue.cheapestPrice > 0,
  );
}

/** Each cohort pub's cheapest listed pint, the numbers an average is taken over. */
export function listedPriceCohortPrices(
  venues: readonly Pick<Venue, "kind" | "cheapestPrice">[],
): number[] {
  return listedPriceCohort(venues).map((venue) => venue.cheapestPrice as number);
}

const fmt = (value: number) => value.toLocaleString("en-GB");

/** "960 of the 2,034 pubs in our London pub list have a pint price on record." */
export function pricedPubsSentence(
  count: PricedPubCount,
  options: { percent?: boolean } = {},
): string {
  const percent =
    options.percent && count.listPubs > 0
      ? ` (${Math.round((count.pricedPubs / count.listPubs) * 100)}%)`
      : "";
  return `${fmt(count.pricedPubs)} of the ${fmt(count.listPubs)} pubs in ${PUB_LIST_BASE} have a pint price on record${percent}.`;
}
