import type { Route } from "next";

import boundaries from "@/data/london_boroughs_simplified.json";
import { isComparablePintServing } from "@/lib/comparablePint.mjs";
import { measureFromServingSize } from "@/lib/drinkMeasure";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { firstHttp } from "@/lib/httpUrl";
import type { BoroughBoundaryCollection } from "@/lib/londonBoroughClassifier";
import { boroughNameForPoint } from "@/lib/londonBoroughPoint.mjs";
import { NAMED_ROUTES, namedRouteCrawl, namedRoutePath } from "@/lib/namedRoutes";
import { isValidObservedAt } from "@/lib/priceUpdateRowShape";
import { authoritativeBundleRows, type UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { venueMenuLookupKeys } from "@/lib/venueMenu";
import { isVerifiedClosedCuratedVenue, isVerifiedClosedPub } from "@/lib/verifiedClosedPubs";
import type { Venue } from "@/lib/venues";
import { londonDayKey } from "@/lib/londonHour";

/** Public menu facts only. No post, account, crew or viewer fields cross here. */
export type SocialAlternatives = {
  crawls: readonly { name: string; href: Route; stops: number }[];
  prices: readonly {
    venueId: string;
    name: string;
    href: Route;
    drink: string;
    serving: string;
    priceGbp: number;
    publisher: { label: string; url: string };
    observedOn: string;
  }[];
  priceRead: "ready" | "unavailable";
};

type SocialAlternativeVenue = Pick<Venue,
  "id" | "name" | "address" | "latitude" | "longitude" | "kind" | "sourceName" | "prices"
>;

/** Project public London pint menu observations. Recency is not a cheapest-price claim. */
export function buildSocialAlternatives(
  venues: readonly SocialAlternativeVenue[],
  updates: readonly DrinkPriceUpdate[] | null,
  now = Date.now(),
  bundleRows: readonly UkPriceBundleRow[] | null = [],
): SocialAlternatives {
  const crawls = NAMED_ROUTES.slice(0, 1).flatMap(({ slug }) => {
    const crawl = namedRouteCrawl(slug);
    return crawl ? [{ name: crawl.name, href: namedRoutePath(slug), stops: crawl.venueIds.length }] : [];
  });
  if (!updates || !bundleRows || venues.length === 0) return { crawls, prices: [], priceRead: "unavailable" };
  const byKey = new Map<string, SocialAlternativeVenue | null>();
  for (const venue of venues) {
    for (const key of venueMenuLookupKeys(venue)) {
      byKey.set(key, byKey.has(key) ? null : venue);
    }
  }
  const prices: SocialAlternatives["prices"][number][] = [];
  const seen = new Set<string>();
  const candidates = [
    ...updates.filter((update) => update.lane === "publisher" && update.source.licence.trim()).map((update) => ({
      ...update, publisher: update.source.label, sourceUrl: update.source.url,
    })),
    // A third party's price index is not a menu, so the listing-site lane stays out.
    ...authoritativeBundleRows(bundleRows).filter((row) => row.standing === "listed" && row.lane !== "estimate" && row.lane !== "listing-site").map((row) => ({
      venueKey: row.venueId, drinkName: row.drinkLabel ?? "", servingSize: row.servingSize,
      priceGbp: row.priceGbp, observedAt: row.observedAt, publisher: row.publisher ?? "", sourceUrl: row.sourceUrl,
    })),
  ];
  const newest = candidates.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)
    || a.venueKey.localeCompare(b.venueKey) || a.drinkName.localeCompare(b.drinkName)
    || (a.servingSize ?? "").localeCompare(b.servingSize ?? ""));
  for (const update of newest) {
    const venue = byKey.get(update.venueKey);
    const serving = update.servingSize?.trim();
    const publisher = update.publisher.trim();
    const sourceUrl = firstHttp(update.sourceUrl);
    if (!venue || seen.has(venue.id) || !isPublicRankablePub(venue)
      || isVerifiedClosedCuratedVenue(venue.id) || isVerifiedClosedPub(venue.id)
      || !boroughNameForPoint(venue.latitude, venue.longitude, boundaries as BoroughBoundaryCollection)
      || !serving || measureFromServingSize(serving) !== "pint" || !isComparablePintServing({ cheapestPint: update.drinkName })
      || !publisher || !sourceUrl || !update.drinkName.trim()
      || !Number.isFinite(update.priceGbp) || update.priceGbp <= 0 || !isValidObservedAt(update.observedAt, now)) continue;
    const day = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(update.observedAt)?.[1];
    if (!day || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) continue;
    seen.add(venue.id);
    prices.push({
      venueId: venue.id, name: venue.name, href: venueMapUrl(venue.id), drink: update.drinkName.trim(),
      serving, priceGbp: update.priceGbp, publisher: { label: publisher, url: sourceUrl },
      observedOn: londonDayKey(new Date(update.observedAt)),
    });
    if (prices.length === 2) break;
  }
  return { crawls, prices, priceRead: "ready" };
}
