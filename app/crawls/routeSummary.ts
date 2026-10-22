// Pure, client-safe route metrics for the /crawls cards (E4). Derives an
// HONEST straight-line summary for a curated crawl from the slim venue index
// (lib/venuesSlim — the only client-side source of venue coords + price):
// haversine leg distances at the shared WALK_KMH pace, and a "pints from"
// range off each stop's cheapestPrice. A route estimate needs every stop.
// Missing coordinates withhold the total rather than shorten the route.
// Mirrors lib/routeLegs semantics ("straight-line", ceil to a
// whole minute, never "0 min") without importing the Venue-typed leg builder.

import { curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import { formatGbp } from "@/lib/formatGbp";
import { getRoutePack } from "@/lib/routePacks";
import { haversineKm } from "@/lib/haversine";
import { WALK_KMH } from "@/lib/routeLegs";
import type { SlimVenue } from "@/lib/venuesSlim";

export type CrawlRouteSummary = {
  /** Straight-line (haversine) total across resolved stops, km. */
  totalKm: number;
  /** Minutes at WALK_KMH, rounded up, floored at 1. */
  totalMinutes: number;
  /** Resolved stop coordinates in [lng, lat] (GeoJSON) order. */
  points: [number, number][];
};

/**
 * Walk venueIds in crawl order, resolving each against the slim index.
 * A missing venue withholds the total. Joining across a missing stop would
 * measure a shorter route than the one the card links to. Fewer than two
 * stops also withhold the estimate.
 */
export function buildCrawlRouteSummary(
  venueIds: readonly string[],
  slimById: ReadonlyMap<string, SlimVenue>,
): CrawlRouteSummary | undefined {
  if (venueIds.length < 2) return undefined;
  const points: [number, number][] = [];
  for (const id of venueIds) {
    const venue = slimById.get(id);
    if (!venue) return undefined;
    points.push([venue.lng, venue.lat]);
  }
  let totalKm = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (from && to) totalKm += haversineKm(from, to);
  }
  const totalMinutes = Math.max(1, Math.ceil((totalKm / WALK_KMH) * 60));
  return { totalKm, totalMinutes, points };
}

export type CrawlPriceRange = { minGbp: number; maxGbp: number };

/**
 * Range of the resolved stops' cheapestPrice values. Stops without a price
 * (null / unresolved) are skipped; no priced stops → undefined (show nothing
 * rather than a fake figure).
 */
export function crawlPriceRange(
  venueIds: readonly string[],
  slimById: ReadonlyMap<string, SlimVenue>,
): CrawlPriceRange | undefined {
  const prices: number[] = [];
  for (const id of venueIds) {
    const price = slimById.get(id)?.cheapestPrice;
    if (typeof price === "number" && Number.isFinite(price)) prices.push(price);
  }
  if (prices.length === 0) return undefined;
  return { minGbp: Math.min(...prices), maxGbp: Math.max(...prices) };
}

/** "£4.20-£6.50", collapsing to "£4.20" when min === max. A hyphen, never an
 * en dash (docs/VOICE.md, "The em-dash law"). */
export function formatPriceRange(range: CrawlPriceRange): string {
  return range.minGbp === range.maxGbp
    ? formatGbp(range.minGbp)
    : `${formatGbp(range.minGbp)}-${formatGbp(range.maxGbp)}`;
}

/**
 * The curated crawls a /crawls view lists, in order: every one, or a route
 * pack's own (?pack=id). The first is the featured crawl. One function, so the
 * server page that picks the featured crawl's photograph and the client page
 * that renders it cannot disagree about which crawl that is.
 */
export function visibleCuratedCrawls(packId: string | undefined): CuratedCrawl[] {
  const pack = packId ? getRoutePack(packId) : undefined;
  if (!pack) return curatedCrawls;
  const ids = new Set(pack.crawlIds);
  return curatedCrawls.filter((crawl) => ids.has(crawl.id));
}
