import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import { omitClosedCuratedVenues } from "@/lib/verifiedClosedPubs";

// Server price readers share the parsed rows and grouped venues in this process.
// Concurrent cold readers share the pending promise. VenueRef remains a
// name/location shape and does not carry prices.
//
// A failed read rejects and caches nothing. An empty list here would read as
// "no prices" to every page cache above it, and a page that memoises that
// answer prints zeros until the process restarts. A caller that can do without
// prices catches the rejection itself.

type VenuePriceDataset = { rows: VenuePrice[]; venues: Venue[] };
let cached: VenuePriceDataset | null = null;
let pending: Promise<VenuePriceDataset> | null = null;

// Read-only cache peek for latency-sensitive optional enrichments. This never
// starts the dataset read; callers may include the data only when another route
// has already warmed this process-local cache.
export function peekPricedVenues(): Venue[] | null {
  return cached?.venues ?? null;
}

export async function getPricedVenues(): Promise<Venue[]> {
  return (await getVenuePriceDataset()).venues;
}

export async function getVenuePriceDataset(): Promise<VenuePriceDataset> {
  if (cached) return cached;
  const read = pending ?? (pending = (async () => {
    const file = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");
    const rows: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(rows)) throw new Error("pint_prices_app_dataset.json is not a list of price rows");
    return { rows: rows as VenuePrice[], venues: omitClosedCuratedVenues(groupVenuePrices(rows as VenuePrice[])) };
  })());
  try {
    const dataset = await read;
    if (pending === read) cached = dataset;
    return dataset;
  } finally {
    if (pending === read) pending = null;
  }
}

export function resetVenuePriceIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    pending = null;
  }
}
