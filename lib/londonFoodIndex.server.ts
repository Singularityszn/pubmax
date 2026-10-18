import "server-only";

import { promises as fs } from "fs";
import path from "path";

import {
  LONDON_FOOD_PACK_PATH,
  parseLondonFoodPack,
  type LondonFoodPlace,
} from "@/lib/londonFoodPlaces";
import { isLondonVenueId } from "@/lib/londonVenueShards";

// Server-only membership index for the London FOOD rows, the sibling of
// lib/ukBaseIndex.ts for `venue-osm-…` ids. A counter is a price target for one
// lane (lib/londonFoodPlaces.ts), so /api/price-submit needs to tell a real
// London counter from a fabricated `venue-osm-…` id. Never accept an id on
// shape alone: an unvalidated id could scope its own rate-limit bucket and
// litter the community-price store with rows no surface can read back.
//
// It reads the committed pack with `fs`, so import it ONLY from server code.
// The browser reads the same pack through lib/londonFoodPlaces.ts, and the
// decode is shared, so the two sides can never disagree about which ids exist.
// The pack is declared for file tracing in lib/venueIndexTracing.mjs
// (`london-food-pack`).
//
// Never throws. A read or parse failure is an explicit `unavailable`, which the
// caller answers with a 503 rather than reading as "no such counter", and it is
// not memoised, so the next call reads again.

export type LondonFoodIndexResult =
  | { status: "ready"; byId: ReadonlyMap<string, LondonFoodPlace> }
  | { status: "unavailable" };

export type LondonFoodPlaceLookup =
  | { status: "ready"; place: LondonFoodPlace }
  | { status: "missing" }
  | { status: "unavailable" };

let cached: LondonFoodIndexResult | null = null;

function packFilePath(): string {
  return path.join(process.cwd(), "public", LONDON_FOOD_PACK_PATH.replace(/^\//, ""));
}

export async function getLondonFoodIndex(): Promise<LondonFoodIndexResult> {
  if (cached) return cached;
  try {
    const places = parseLondonFoodPack(
      JSON.parse(await fs.readFile(/* turbopackIgnore: true */ packFilePath(), "utf8")),
    );
    if (!places || places.length === 0) return { status: "unavailable" };
    cached = {
      status: "ready",
      byId: new Map(places.map((place) => [place.id, place] as const)),
    };
    return cached;
  } catch {
    return { status: "unavailable" };
  }
}

/** One London counter by its `venue-osm-` id, or an explicit miss. */
export async function lookupLondonFoodPlace(id: string): Promise<LondonFoodPlaceLookup> {
  if (!isLondonVenueId(id)) return { status: "missing" };
  const index = await getLondonFoodIndex();
  if (index.status === "unavailable") return { status: "unavailable" };
  const place = index.byId.get(id);
  return place && place.kind === "food" ? { status: "ready", place } : { status: "missing" };
}
