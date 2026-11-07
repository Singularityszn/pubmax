// Pure, client-safe route metrics for the /crawls cards (E4). Derives an
// HONEST straight-line summary for a curated crawl from the slim venue index
// (lib/venuesSlim — the only client-side source of venue coords + price):
// haversine leg distances at the shared WALK_KMH pace, and a "Listed pints"
// range off each stop's comparable listed pint. A route estimate needs every stop.
// Missing coordinates withhold the total rather than shorten the route.
// Mirrors lib/routeLegs semantics ("straight-line", ceil to a
// whole minute, never "0 min") without importing the Venue-typed leg builder.

import { curatedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import { comparableVenuePint } from "@/lib/comparableVenuePint";
import { venuePriceEvidence, type VenuePriceEvidence } from "@/lib/venuePriceEvidence";
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

type CrawlPriceEndpoint = {
  venueId: string;
  venueName: string;
  priceGbp: number;
  evidence: VenuePriceEvidence;
};

export type CrawlPriceRange = {
  minGbp: number;
  maxGbp: number;
  min: CrawlPriceEndpoint;
  max: CrawlPriceEndpoint;
  pricedStops: number;
  totalStops: number;
};

/**
 * Range of the resolved stops' comparable listed pints, with each endpoint's
 * own evidence. The first stop at an equal price keeps the endpoint. Missing
 * or refused figures stay outside the range and its priced-stop count.
 */
export function crawlPriceRange(
  venueIds: readonly string[],
  slimById: ReadonlyMap<string, SlimVenue>,
  now?: number,
): CrawlPriceRange | undefined {
  const prices: CrawlPriceEndpoint[] = [];
  for (const id of venueIds) {
    const venue = slimById.get(id);
    if (!venue) continue;
    const price = comparableVenuePint(venue, null, false, now);
    if (price === null) continue;
    prices.push({
      venueId: venue.id,
      venueName: venue.name,
      priceGbp: price,
      evidence: venuePriceEvidence(venue, price, false),
    });
  }
  if (prices.length === 0) return undefined;
  let min = prices[0]!;
  let max = min;
  for (const price of prices) {
    if (price.priceGbp < min.priceGbp) min = price;
    if (price.priceGbp > max.priceGbp) max = price;
  }
  return { minGbp: min.priceGbp, maxGbp: max.priceGbp, min, max,
    pricedStops: prices.length, totalStops: venueIds.length };
}

/** "£4.20-£6.50", collapsing to "£4.20" when min === max. A hyphen, never an
 * en dash (docs/VOICE.md, "The em-dash law"). */
export function formatPriceRange(range: Pick<CrawlPriceRange, "minGbp" | "maxGbp">): string {
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
