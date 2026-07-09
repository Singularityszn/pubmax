import { promises as fs } from "fs";
import path from "path";

import { venueMapUrl } from "@/lib/venueMapUrl";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

export { venueMapUrl };

// Server-only venue-name resolution (PRD §9). Social content stores raw venue
// ids (content-hashed, e.g. "venue-1ufn31x"); no public feed/profile/permalink
// card should ever show that id as the venue label. This module turns an id into
// a { name, borough, lat, lng } ref so server routes can enrich their DTOs with
// a real pub name + a "open on the map" link before the client renders them.
//
// It reads the bundled dataset with `fs` — so import it ONLY from server code
// (route handlers, server components, generateMetadata). Client components get
// the resolved name through the API response, never by importing this file.

export type VenueRef = {
  id: string;
  name: string;
  borough: string;
  lat: number;
  lng: number;
};

// Pure: fold grouped venues into an id→ref lookup. Split out so it's unit-testable
// with small fixtures instead of the 6 MB dataset.
export function buildVenueIndex(venues: Venue[]): Map<string, VenueRef> {
  const index = new Map<string, VenueRef>();
  for (const v of venues) {
    index.set(v.id, {
      id: v.id,
      name: v.name,
      borough: v.primaryBorough || "London",
      lat: v.latitude,
      lng: v.longitude,
    });
  }
  return index;
}

let cached: Map<string, VenueRef> | null = null;

// Read the dataset once and memoize. Never throws: a read/parse failure yields an
// empty index so name resolution degrades to the friendly fallback rather than
// 500-ing a page. The dataset is the same file the client fetches at /data/…, read
// here from disk so it never enters the client bundle.
export async function getVenueIndex(): Promise<Map<string, VenueRef>> {
  if (cached) return cached;
  try {
    const file = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
    cached = buildVenueIndex(groupVenuePrices(Array.isArray(rows) ? rows : []));
  } catch {
    cached = new Map();
  }
  return cached;
}

export async function resolveVenue(id: string): Promise<VenueRef | null> {
  if (!id) return null;
  return (await getVenueIndex()).get(id) ?? null;
}

// A display label that never surfaces a raw id: the pub name, or a friendly
// fallback for an id the dataset no longer carries.
export async function venueLabel(id: string): Promise<string> {
  return (await resolveVenue(id))?.name ?? "A London pub";
}

