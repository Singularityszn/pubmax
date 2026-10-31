// Named route pages (SEO audit #2126, findings 15, 16 and 26). Four curated
// crawls get a page of their own under /routes/{slug}: the ordered stops, each
// stop's cheapest listed pint with its publisher and read day, and the walk
// between stops. /crawls/{slug} stays the namespace for user Crawl Stories.
//
// Pure: the page hands in the grouped venues, so the rules are testable with
// small fixtures. Two honesty rules ride with it:
//   1. A walk figure is a straight line at WALK_KMH, so it is always printed as
//      "about N min (straight-line estimate)", never as a walk.
//   2. A route total needs every stop. One stop we cannot place withholds the
//      total, because joining across the gap would measure a shorter route.

import type { Route } from "next";

import { curatedCrawlById, curatedCrawlMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";
import { haversineKm } from "@/lib/haversine";
import { legacyCheapestPriceEvidence } from "@/lib/legacyPriceEvidence.mjs";
import { cheapestPriceReadDay } from "@/lib/priceReadDay.mjs";
import { WALK_KMH } from "@/lib/routeLegs";
import type { Venue } from "@/lib/venues";

export const NAMED_ROUTES = [
  { slug: "victorian-soho", crawlId: "victorian-soho" },
  { slug: "camden-market", crawlId: "camden-market-crawl" },
  { slug: "borough-market", crawlId: "borough-market-crawl" },
  { slug: "fleet-street", crawlId: "fleet-street-writers" },
] as const;

export type NamedRouteSlug = (typeof NAMED_ROUTES)[number]["slug"];

export function namedRoutePath(slug: NamedRouteSlug): Route {
  return `/routes/${slug}` as Route;
}

/** The named route page for a curated crawl, or null when it has none. */
export function namedRoutePathForCrawl(crawlId: string): Route | null {
  const entry = NAMED_ROUTES.find((route) => route.crawlId === crawlId);
  return entry ? namedRoutePath(entry.slug) : null;
}

export function namedRouteCrawl(slug: string): CuratedCrawl | null {
  const entry = NAMED_ROUTES.find((route) => route.slug === slug);
  return entry ? (curatedCrawlById(entry.crawlId) ?? null) : null;
}

/** "about 4 min (straight-line estimate)": whole minutes, never "0 min". */
export function straightLineMinutesLabel(km: number): string {
  const minutes = Math.max(1, Math.ceil((km / WALK_KMH) * 60));
  return `about ${minutes} min (straight-line estimate)`;
}

export type NamedRouteStop = {
  position: number;
  venueId: string;
  name: string;
  address: string;
  area: string;
  pint: {
    priceGbp: number;
    drinkName: string;
    /** The publisher the price row names, or null when it names none. */
    source: string | null;
    /** The London day the price was read, YYYY-MM-DD, or null when unrecorded. */
    readDay: string | null;
  } | null;
  /** Straight-line distance from the previous stop, km. Null for the first stop. */
  legKm: number | null;
};

export type NamedRoute = {
  slug: NamedRouteSlug;
  crawl: CuratedCrawl;
  stops: NamedRouteStop[];
  /** Ids the dataset no longer holds. Any one withholds the total. */
  missingVenueIds: string[];
  /** Straight-line total across every stop, or null when a stop is missing. */
  totalKm: number | null;
  mapHref: Route;
};

function stopPint(venue: Venue): NamedRouteStop["pint"] {
  const price = venue.cheapestPrice;
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  const row = venue.prices.find((candidate) => candidate.price_gbp === price);
  const evidence = legacyCheapestPriceEvidence(venue.prices, price);
  return {
    priceGbp: price,
    drinkName: row?.pint_name?.trim() || venue.cheapestPint,
    source: evidence.priceSource ?? null,
    readDay: cheapestPriceReadDay(venue.prices, price),
  };
}

export function buildNamedRoute(slug: NamedRouteSlug, venues: readonly Venue[]): NamedRoute | null {
  const crawl = namedRouteCrawl(slug);
  if (!crawl) return null;
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const stops: NamedRouteStop[] = [];
  const missingVenueIds: string[] = [];
  let previous: Venue | null = null;
  let totalKm = 0;
  for (const venueId of crawl.venueIds) {
    const venue = byId.get(venueId);
    if (!venue) {
      missingVenueIds.push(venueId);
      previous = null;
      continue;
    }
    // A leg is measured only from the stop directly before it.
    const legKm = previous
      ? haversineKm([previous.longitude, previous.latitude], [venue.longitude, venue.latitude])
      : null;
    if (legKm !== null) totalKm += legKm;
    stops.push({
      position: crawl.venueIds.indexOf(venueId) + 1,
      venueId,
      name: venue.name,
      address: venue.address,
      area: venue.locality?.trim() || venue.primaryBorough,
      pint: stopPint(venue),
      legKm,
    });
    previous = venue;
  }
  return {
    slug,
    crawl,
    stops,
    missingVenueIds,
    totalKm: missingVenueIds.length === 0 && stops.length > 1 ? totalKm : null,
    mapHref: curatedCrawlMapHref(crawl),
  };
}

/** Document title. Both claims are true: the page costs nothing and nobody leads it. */
export function namedRouteTitle(crawl: CuratedCrawl): string {
  return `${crawl.name}: a free, self-guided London pub crawl`;
}

/** The meta description. The caller passes the blurb through its dash rule. */
export function namedRouteDescription(crawl: CuratedCrawl, blurb: string = crawl.blurb): string {
  const stops = crawl.venueIds.length;
  return `${stops} pubs in order, with each pub's cheapest listed pint, its source and the day it was read. ${blurb}`
    .replace(/\s+/g, " ")
    .trim();
}
