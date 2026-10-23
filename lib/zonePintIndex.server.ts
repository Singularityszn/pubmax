import "server-only";

// Server-only: compute the Zone pint index from the slim venue index.
//
// The slim index (public/data/venues_slim.json) already carries each venue's
// nearest-station fare `zone` and `cheapestPrice`, so the zone medians are a
// pure roll-up of the SAME observed prices the map shows — no separate source,
// no invented numbers. Import from Server Components / route handlers only.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { isVenueKind, type VenueKind } from "@/lib/venues";
import { computeZonePintIndex, type ZonePintIndex } from "@/lib/zones";

type SlimRow = { zone?: unknown; cheapestPrice?: unknown; kind?: unknown };

function toFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `undefined` means "a row from before the vocabulary existed", which
 * `computeZonePintIndex` counts as a pub. A kind this build does not hold is a
 * different answer: the row NAMES something, we just do not know what, so it
 * lands on the neutral kind and stays out of the median. A price authority
 * fails closed.
 */
function toSlimKind(value: unknown): VenueKind | undefined {
  if (value === undefined || value === null) return undefined;
  return isVenueKind(value) ? value : "other";
}

let cached: ZonePintIndex | null = null;
let pending: Promise<ZonePintIndex | null> | null = null;

async function load(): Promise<ZonePintIndex | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "venues_slim.json");
    const payload = JSON.parse(await readFile(file, "utf8")) as unknown;
    const list: SlimRow[] = Array.isArray(payload)
      ? (payload as SlimRow[])
      : payload && typeof payload === "object" && Array.isArray((payload as { rows?: unknown }).rows)
        ? (payload as { rows: SlimRow[] }).rows
        : [];
    cached = computeZonePintIndex(
      list.map((row) => ({
        zone: toFinite(row.zone),
        cheapestPrice: toFinite(row.cheapestPrice),
        kind: toSlimKind(row.kind),
      })),
    );
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
