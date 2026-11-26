import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import { omitClosedCuratedVenues } from "@/lib/verifiedClosedPubs";

// Concurrent readers share the parsed rows and grouped venues. A failed read
// is not cached. Closure exclusions are reconsidered each UTC day.
type VenuePriceDataset = { rows: VenuePrice[]; venues: Venue[] };
let cached: VenuePriceDataset | null = null;
let allVenues: Venue[] | null = null;
let cachedDay = "";
let pending: Promise<VenuePriceDataset> | null = null;

function currentDataset(): VenuePriceDataset | null {
  if (!cached || !allVenues) return null;
  const day = new Date().toISOString().slice(0, 10);
  if (cachedDay !== day) {
    cached = { rows: cached.rows, venues: omitClosedCuratedVenues(allVenues) };
    cachedDay = day;
  }
  return cached;
}

export function peekPricedVenues(): Venue[] | null {
  return currentDataset()?.venues ?? null;
}

export async function getPricedVenues(): Promise<Venue[]> {
  return (await getVenuePriceDataset()).venues;
}

export async function getVenuePriceDataset(): Promise<VenuePriceDataset> {
  const current = currentDataset();
  if (current) return current;
  const read = pending ?? (pending = (async () => {
    const file = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");
    const rows: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(rows)) throw new Error("pint_prices_app_dataset.json is not a list of price rows");
    return { rows: rows as VenuePrice[], venues: groupVenuePrices(rows as VenuePrice[]) };
  })());
  try {
    const dataset = await read;
    if (pending === read) {
      allVenues = dataset.venues;
      cached = { rows: dataset.rows, venues: omitClosedCuratedVenues(dataset.venues) };
      cachedDay = new Date().toISOString().slice(0, 10);
    }
    return currentDataset() ?? { rows: dataset.rows, venues: omitClosedCuratedVenues(dataset.venues) };
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
    allVenues = null;
    cachedDay = "";
    pending = null;
  }
}
