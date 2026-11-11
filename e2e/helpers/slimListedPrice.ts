import { readFileSync } from "node:fs";

import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { formatGbp } from "@/lib/formatGbp";
import type { SlimVenue } from "@/lib/venuesSlim";

export type SlimListedPrice = {
  name: string;
  priceGbp: number;
  priceLabel: string;
  source: string;
  observedOn: string;
  readDay: string;
};

let rows: readonly SlimVenue[] | null = null;

/** Every row of the committed London slim pack, as the map and Pal load it. */
export function slimLondonRows(): readonly SlimVenue[] {
  rows ??= (JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")) as { rows: SlimVenue[] }).rows;
  return rows;
}

/**
 * One venue's listed price from the committed London slim pack. A price
 * refresh moves these values, so a spec reads them here instead of typing them.
 */
export function slimListedPrice(venueId: string): SlimListedPrice {
  const row = slimLondonRows().find((candidate) => candidate.id === venueId);
  if (!row || row.cheapestPrice == null || !row.priceSource || !row.priceObservedAt) {
    throw new Error(`${venueId} has no dated listed price in public/data/venues_slim.json`);
  }
  return {
    name: row.name,
    priceGbp: row.cheapestPrice,
    priceLabel: formatGbp(row.cheapestPrice),
    source: row.priceSource,
    observedOn: row.priceObservedAt,
    readDay: formatObservedDate(new Date(`${row.priceObservedAt}T12:00:00Z`)),
  };
}
