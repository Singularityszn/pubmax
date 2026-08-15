import "server-only";

import { cache } from "react";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildNightAreaLanding,
  listNightAreaLandings,
  type NightAreaLanding,
} from "@/lib/nightAreaLanding";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const loadNightAreaLandingVenues = cache(async (): Promise<Venue[]> => {
  const file = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "public",
    "data",
    "pint_prices_app_dataset.json",
  );
  const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("area landing: Pint Price dataset is empty or malformed");
  }
  const venues = groupVenuePrices(parsed as VenuePrice[]);
  if (venues.length === 0) {
    throw new Error("area landing: grouped Venue set is empty");
  }
  return venues;
});

export async function loadNightAreaLandings(now = new Date()): Promise<NightAreaLanding[]> {
  return listNightAreaLandings(await loadNightAreaLandingVenues(), NIGHT_AREAS, now);
}

export async function loadNightAreaLanding(
  slug: string,
  now = new Date(),
): Promise<NightAreaLanding | null> {
  const area = NIGHT_AREAS.find((candidate) => candidate.slug === slug);
  if (!area) return null;
  return buildNightAreaLanding(area, await loadNightAreaLandingVenues(), NIGHT_AREAS, now);
}
