import { promises as fs } from "fs";
import path from "path";

import { listEnabledCities } from "@/lib/cities";
import { unresolvedVenueLabel } from "@/lib/cityVenueIds";
import { resolveCanonicalVenueId } from "@/lib/venueAliases";
import type { Venue } from "@/lib/venues";

// Server-only venue-name resolution (PRD §9). Social content stores raw venue
// ids (content-hashed, e.g. "venue-1ufn31x"); no public feed/profile/permalink
// card should ever show that id as the venue label. This module turns an id into
// a { name, borough, lat, lng } ref so server routes can enrich their DTOs with
// a real pub name + a "open on the map" link before the client renders them.
//
// It reads the SLIM index (~400 KB) with `fs` — so import it ONLY from server
// code (route handlers, server components, generateMetadata). Client components
// get the resolved name through the API response, never by importing this file.

export type VenueRef = {
  id: string;
  name: string;
  borough: string;
  lat: number;
  lng: number;
};

type SlimRow = {
  id?: unknown;
  name?: unknown;
  borough?: unknown;
  lat?: unknown;
  lng?: unknown;
};

// Pure: fold venues into an id→ref lookup. Split out so it's unit-testable
// with small fixtures instead of the full dataset.
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

function buildVenueIndexFromSlim(rows: SlimRow[]): Map<string, VenueRef> {
  const index = new Map<string, VenueRef>();
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) continue;
    if (typeof row.name !== "string" || !row.name) continue;
    const lat = typeof row.lat === "number" ? row.lat : Number(row.lat);
    const lng = typeof row.lng === "number" ? row.lng : Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    index.set(row.id, {
      id: row.id,
      name: row.name,
      borough: typeof row.borough === "string" && row.borough ? row.borough : "London",
      lat,
      lng,
    });
  }
  return index;
}

let cached: Map<string, VenueRef> | null = null;

function publicDataPath(publicPath: string): string {
  return path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
}

async function readSlimIndex(publicPath: string): Promise<Map<string, VenueRef>> {
  const rows = JSON.parse(await fs.readFile(publicDataPath(publicPath), "utf8")) as SlimRow[];
  return buildVenueIndexFromSlim(Array.isArray(rows) ? rows : []);
}

// Read the slim index once and memoize. Never throws: a read/parse failure
// yields an empty index so name resolution degrades to the friendly fallback
// rather than 500-ing a page. Prefer venues_slim.json (~400 KB) over the full
// ~6 MB price dataset — name/borough/coords are all the social DTOs need.
//
// Per-city try/catch: one missing/corrupt city pack must not wipe London (or
// any other city that loaded). Only cache when at least one city succeeded so
// a total miss can retry on the next call.
export async function getVenueIndex(): Promise<Map<string, VenueRef>> {
  if (cached) return cached;
  const index = new Map<string, VenueRef>();
  let loadedAny = false;
  for (const city of listEnabledCities()) {
    try {
      for (const [id, ref] of await readSlimIndex(city.slimVenuesPath)) {
        index.set(id, ref);
      }
      loadedAny = true;
    } catch {
      // Skip this city; keep whatever already loaded.
    }
  }
  if (!loadedAny) return new Map();
  cached = index;
  return cached;
}

export async function resolveVenue(id: string): Promise<VenueRef | null> {
  if (!id) return null;
  const index = await getVenueIndex();
  const direct = index.get(id);
  if (direct) return direct;
  // Fall back to the D1 alias map so a reference to a merged duplicate id still
  // resolves to the surviving canonical venue.
  const canonical = await resolveCanonicalVenueId(id);
  return canonical === id ? null : index.get(canonical) ?? null;
}

// A display label that never surfaces a raw id: the pub name, or a friendly
// fallback for an id the dataset no longer carries.
export async function venueLabel(id: string): Promise<string> {
  return (await resolveVenue(id))?.name ?? unresolvedVenueLabel(id);
}

export { unresolvedVenueLabel } from "@/lib/cityVenueIds";

export function resetVenueIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
  }
}

// Re-export the client-safe helper so existing server imports keep working.
export { venueMapUrl } from "@/lib/venueMapUrl";
