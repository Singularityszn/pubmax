import "server-only";

// Server-only: compute the Zone pint index from the slim venue index.
//
// The slim index (public/data/venues_slim.json) already carries each venue's
// nearest-station fare `zone` and `cheapestPrice`, so the zone medians are a
// pure roll-up of the SAME observed prices the map shows — no separate source,
// no invented numbers. Import from Server Components / route handlers only.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { zonePintIndexFromSlimPayload } from "@/lib/zonePriceEstimate";
import { toZoneId, type ZoneId, type ZonePintIndex } from "@/lib/zones";

let cached: ZonePintIndex | null = null;
let zonesById: ReadonlyMap<string, ZoneId> = new Map();
let pending: Promise<ZonePintIndex | null> | null = null;

async function load(): Promise<ZonePintIndex | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "venues_slim.json");
    const payload = JSON.parse(await readFile(file, "utf8")) as unknown;
    cached = zonePintIndexFromSlimPayload(payload, new Date().toISOString());
    zonesById = new Map((rowsFromSlimPayload(payload) ?? []).flatMap((item) => {
      const row = (item && typeof item === "object" ? item : {}) as { id?: unknown; zone?: unknown };
      const zone = toZoneId(row.zone);
      return typeof row.id === "string" && zone !== null ? [[row.id, zone] as const] : [];
    }));
    return cached;
  } catch {
    // Deliberately NOT cached: a read we could not run says nothing about the
    // index, and freezing it would turn one bad moment into a permanent one.
    return null;
  } finally {
    pending = null;
  }
}

/**
 * The slim index rolled up into the per-zone pint index, read once per server
 * process because the file only changes on deploy. Null when the file could not
 * be read, so a caller that holds another source can fall back to it rather
 * than print every zone as thin.
 */
export async function loadZonePintIndex(): Promise<ZonePintIndex | null> {
  if (cached) return cached;
  pending ??= load();
  return pending;
}

/** A London pub's fare zone from the same read, or null when the index holds none. */
export async function loadVenueZone(venueId: string): Promise<ZoneId | null> {
  await loadZonePintIndex();
  return zonesById.get(venueId) ?? null;
}
