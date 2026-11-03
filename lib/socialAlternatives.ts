import type { Route } from "next";

import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { firstHttp } from "@/lib/httpUrl";
import { NAMED_ROUTES, namedRouteCrawl, namedRoutePath } from "@/lib/namedRoutes";
import { isValidObservedAt } from "@/lib/priceUpdateRowShape";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { venueMenuLookupKeys } from "@/lib/venueMenu";
import { isVerifiedClosedCuratedVenue } from "@/lib/verifiedClosedPubs";
import type { Venue } from "@/lib/venues";

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

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London",
});

type SocialAlternativeVenue = Pick<Venue,
  "id" | "name" | "address" | "latitude" | "longitude" | "kind" | "sourceName" | "prices"
>;

/** Project public London menu observations. Recency is not a cheapest-price claim. */
export function buildSocialAlternatives(
  venues: readonly SocialAlternativeVenue[],
  updates: readonly DrinkPriceUpdate[] | null,
  now = Date.now(),
): SocialAlternatives {
  const crawls = NAMED_ROUTES.slice(0, 1).flatMap(({ slug }) => {
    const crawl = namedRouteCrawl(slug);
    return crawl ? [{ name: crawl.name, href: namedRoutePath(slug), stops: crawl.venueIds.length }] : [];
  });
  if (!updates || venues.length === 0) return { crawls, prices: [], priceRead: "unavailable" };
  const byKey = new Map<string, SocialAlternativeVenue>();
  for (const venue of venues) {
    if (!isPublicRankablePub(venue) || isVerifiedClosedCuratedVenue(venue.id)) continue;
    for (const key of venueMenuLookupKeys(venue)) byKey.set(key, venue);
  }
  const prices: SocialAlternatives["prices"][number][] = [];
  const seen = new Set<string>();
  const newest = [...updates].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)
    || a.venueKey.localeCompare(b.venueKey) || a.drinkName.localeCompare(b.drinkName)
    || (a.servingSize ?? "").localeCompare(b.servingSize ?? ""));
  for (const update of newest) {
    const venue = byKey.get(update.venueKey);
    const serving = update.servingSize?.trim();
    const publisher = update.source.label.trim();
    const sourceUrl = firstHttp(update.source.url);
    if (!venue || seen.has(venue.id) || update.lane !== "publisher" || !serving || !publisher || !sourceUrl
      || !update.drinkName.trim() || !update.source.licence.trim()
      || !Number.isFinite(update.priceGbp) || update.priceGbp <= 0 || !isValidObservedAt(update.observedAt, now)) continue;
    const day = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(update.observedAt)?.[1];
    if (!day || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) continue;
    seen.add(venue.id);
    prices.push({
      venueId: venue.id, name: venue.name, href: venueMapUrl(venue.id), drink: update.drinkName.trim(),
      serving, priceGbp: update.priceGbp, publisher: { label: publisher, url: sourceUrl },
      observedOn: LONDON_DAY.format(new Date(update.observedAt)),
    });
    if (prices.length === 2) break;
  }
  return { crawls, prices, priceRead: "ready" };
}
