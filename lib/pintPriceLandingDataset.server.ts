import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { cache } from "react";

import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

export const loadPintPriceLandingVenues = cache(async (): Promise<Venue[]> => {
  const file = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "public",
    "data",
    "pint_prices_app_dataset.json",
  );
  const rows: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("price landing: Pint Price dataset is empty or malformed");
  }
  const venues = groupVenuePrices(rows as VenuePrice[]);
  if (venues.length === 0) {
    throw new Error("price landing: grouped Venue set is empty");
  }
  return venues;
});
