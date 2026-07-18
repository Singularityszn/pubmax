// Server-only: compute the Zone pint index from the slim venue index.
//
// The slim index (public/data/venues_slim.json) already carries each venue's
// nearest-station fare `zone` and `cheapestPrice`, so the zone medians are a
// pure roll-up of the SAME observed prices the map shows — no separate source,
// no invented numbers. Import from Server Components / route handlers only.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { computeZonePintIndex, type ZonePintIndex } from "@/lib/zones";

type SlimRow = { zone?: unknown; cheapestPrice?: unknown };

function toFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Load the slim index and roll it up into the per-zone pint index. */
export async function loadZonePintIndex(): Promise<ZonePintIndex> {
  try {
    const file = path.join(process.cwd(), "public", "data", "venues_slim.json");
    const rows = JSON.parse(await readFile(file, "utf8")) as unknown;
    const list: SlimRow[] = Array.isArray(rows) ? (rows as SlimRow[]) : [];
    return computeZonePintIndex(
      list.map((row) => ({
        zone: toFinite(row.zone),
        cheapestPrice: toFinite(row.cheapestPrice),
      })),
    );
  } catch {
    // No slim index (fresh checkout before build) → an all-thin index that the
    // strip renders honestly as "not enough pints logged yet".
    return computeZonePintIndex([]);
  }
}
