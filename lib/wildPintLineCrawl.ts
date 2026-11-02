// THE CRAWL, AS PLAIN DATA, FOR THE TWO WILD CRAWL SURFACES (the Pint Line and
// the crawl receipt, docs/plans/DESIGN_UX_PLAN.md section 12).
//
// The server page builds this from the route it already renders
// (lib/wildPintLineRoute.ts) and hands it to client components that load only
// while the wild switch is on (lib/wildMode.ts). It is a leaf: no runtime
// import, so a client chunk that reads it pulls nothing in behind it.
//
// Two honesty rules ride with the sums here:
//   1. A stop with no listed price is left out of every total, and the count of
//      such stops is returned so the surface can say so.
//   2. A round is a pint for every person at every priced stop. The share each
//      person pays is therefore one pint at each priced stop. The prototype
//      split five pints three ways (£10.33 each), which is not what three
//      people drinking at five pubs spend.

export type WildCrawlBand = "cheap" | "average" | "expensive";

export type WildCrawlPint = {
  priceGbp: number;
  /** The drink's display name, for example "Heineken". */
  drink: string;
  /** The price band (lib/priceBand.ts), or null when the figure takes none. */
  band: WildCrawlBand | null;
  /** The publisher the price row names, or null when it names none. */
  source: string | null;
  /** The London day the price was read, YYYY-MM-DD, or null when unrecorded. */
  readDay: string | null;
  /** The read day as a reader sees it, for example "2 October 2026". */
  readDayLabel: string | null;
};

export type WildCrawlStop = {
  /** The stop's place in the crawl, from 1. */
  position: number;
  name: string;
  /** [longitude, latitude], or null when we cannot place the stop. */
  point: readonly [number, number] | null;
  pint: WildCrawlPint | null;
  /** Straight-line walk from the stop before, whole minutes. Null for the first stop. */
  legMinutes: number | null;
};

export type WildCrawl = {
  name: string;
  /** The stops the crawl plans, including any the dataset no longer holds. */
  plannedStops: number;
  stops: WildCrawlStop[];
  /** Straight-line total, km, or null when a stop is missing. */
  totalKm: number | null;
  /** Straight-line total, whole minutes, or null when a stop is missing. */
  totalMinutes: number | null;
};

export const RECEIPT_MIN_PEOPLE = 1;
export const RECEIPT_MAX_PEOPLE = 8;

/** £ to whole pence, so sums never drift by a fraction of a penny. */
export function toPence(gbp: number): number {
  return Math.round(gbp * 100);
}

/** 3100 → "£31.00". */
export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function clampPeople(people: number): number {
  if (!Number.isFinite(people)) return RECEIPT_MIN_PEOPLE;
  return Math.min(RECEIPT_MAX_PEOPLE, Math.max(RECEIPT_MIN_PEOPLE, Math.round(people)));
}

export type CrawlRound = {
  people: number;
  pricedStops: number;
  unpricedStops: number;
  /** One pint at each priced stop, pence. What one person drinks. */
  pintEachStopPence: number;
  /** A pint for every person at every priced stop, pence. */
  roundPence: number;
  /** The round split evenly, pence. Equal to pintEachStopPence. */
  eachPence: number;
  /** How many pints the round buys. */
  pints: number;
};

export function crawlRound(stops: readonly WildCrawlStop[], people: number): CrawlRound {
  const count = clampPeople(people);
  const priced = stops.filter((stop) => stop.pint && Number.isFinite(stop.pint.priceGbp) && stop.pint.priceGbp > 0);
  const pintEachStopPence = priced.reduce((sum, stop) => sum + toPence(stop.pint!.priceGbp), 0);
  const roundPence = pintEachStopPence * count;
  return {
    people: count,
    pricedStops: priced.length,
    unpricedStops: stops.length - priced.length,
    pintEachStopPence,
    roundPence,
    eachPence: Math.round(roundPence / count),
    pints: priced.length * count,
  };
}

export type CrawlPriceListing = {
  /** The earliest and latest read day labels, or null when no priced stop has one. */
  firstDayLabel: string | null;
  lastDayLabel: string | null;
  /** Every publisher named, in first-seen order. */
  sources: string[];
  /** Priced stops whose read day is unrecorded. */
  undated: number;
  /** Priced stops whose publisher is unrecorded. */
  unsourced: number;
};

/** Who listed the crawl's prices, and when, read off the priced stops. */
export function crawlPriceListing(stops: readonly WildCrawlStop[]): CrawlPriceListing {
  const dated: Array<{ day: string; label: string }> = [];
  const sources: string[] = [];
  let undated = 0;
  let unsourced = 0;
  for (const stop of stops) {
    const pint = stop.pint;
    if (!pint) continue;
    if (pint.readDay && pint.readDayLabel) dated.push({ day: pint.readDay, label: pint.readDayLabel });
    else undated += 1;
    const source = pint.source?.trim();
    if (source) {
      if (!sources.includes(source)) sources.push(source);
    } else {
      unsourced += 1;
    }
  }
  dated.sort((a, b) => a.day.localeCompare(b.day));
  return {
    firstDayLabel: dated[0]?.label ?? null,
    lastDayLabel: dated[dated.length - 1]?.label ?? null,
    sources,
    undated,
    unsourced,
  };
}

/** "2 October 2026", or "2 October 2026 to 9 October 2026", or null. */
export function listedDaysText(listing: CrawlPriceListing): string | null {
  if (!listing.firstDayLabel) return null;
  if (!listing.lastDayLabel || listing.lastDayLabel === listing.firstDayLabel) return listing.firstDayLabel;
  return `${listing.firstDayLabel} to ${listing.lastDayLabel}`;
}

/** "Pint Prices", "Pint Prices and Camra", "A, B and C". */
export function sourcesText(sources: readonly string[]): string | null {
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0]!;
  return `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}`;
}

/** "about 7 min": the house's word for a straight-line estimate. */
export function aboutMinutes(minutes: number): string {
  return `about ${Math.max(1, Math.round(minutes))} min`;
}

/** 0.4498 → "0.4 km"; under 100 m reads in metres. */
export function formatKm(km: number): string {
  if (km < 0.1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toFixed(1)} km`;
}

/** "1 stop", "5 stops". */
export function stopsText(count: number): string {
  return `${count} ${count === 1 ? "stop" : "stops"}`;
}
