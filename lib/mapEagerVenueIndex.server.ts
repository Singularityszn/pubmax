import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MAP_EAGER_VENUE_INDEX_FILE } from "@/lib/mapEagerVenueIndexFile.mjs";
import type { MapSelectableVenueIds } from "@/lib/pricedLanding";

// Which pubs a `?sel=` arrival can actually open.
//
// The slim index is SHARDED: the map loads the core shard eagerly and a borough
// shard only when the viewport or a geolocation fix reaches into it, so a `sel`
// naming a pub outside core resolves against nothing, the venue sheet never
// opens and the log intent falls through to the generic picker. A server
// surface that links into the map therefore has to ask this question BEFORE it
// names a pub.
//
// The answer is TRI-STATE by way of null: a read that could not run says
// NEITHER "selectable" nor "not selectable", and a caller then names no pub
// rather than one the map would drop.

let cached: ReadonlySet<string> | null = null;

function parseVenueIds(payload: unknown): ReadonlySet<string> | null {
  if (!Array.isArray(payload)) return null;
  const ids = new Set<string>();
  for (const row of payload) {
    if (typeof row !== "object" || row === null) continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string" && id) ids.add(id);
  }
  // An empty core shard is not a real state, so read it as a failed read
  // rather than as a map that can open nothing.
  return ids.size > 0 ? ids : null;
}

/** The eager shard's venue ids, or null when the shard could not be read. */
export async function loadMapSelectableVenueIds(): Promise<MapSelectableVenueIds> {
  if (cached) return cached;
  try {
    const file = join(
      /* turbopackIgnore: true */ process.cwd(),
      MAP_EAGER_VENUE_INDEX_FILE,
    );
    const parsed = parseVenueIds(
      JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8")) as unknown,
    );
    // A failed read is not cached, so the next request tries again.
    if (parsed) cached = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function resetMapEagerVenueIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
  }
}
