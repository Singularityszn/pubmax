import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CuratedWalk } from "@/lib/curatedWalk";
import { curatedWalkPubs } from "@/lib/curatedWalkPubs";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { slimVenuesToPins } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { Venue } from "@/lib/venues";

// The index only changes on deploy, so one read serves the process. A failed
// read is not kept: it says nothing about the index.
let pending: Promise<Venue[]> | null = null;

async function readMapPins(): Promise<Venue[]> {
  const file = path.join(process.cwd(), "public", "data", "venues_slim.json");
  const rows = rowsFromSlimPayload(JSON.parse(await readFile(file, "utf8")) as unknown) ?? [];
  return slimVenuesToPins(rows as SlimVenue[]);
}

/**
 * Pubs along a walk, counted from the index the map paints, so a card and the
 * map print the same figure. The grouped price dataset holds other kinds and
 * coarser coordinates. 0 when the index cannot be read.
 */
export async function curatedWalkPubCount(walk: CuratedWalk): Promise<number> {
  const inflight = pending ?? (pending = readMapPins());
  try {
    return curatedWalkPubs(walk, await inflight).total;
  } catch {
    if (pending === inflight) pending = null;
    return 0;
  }
}
