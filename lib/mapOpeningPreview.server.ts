import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { openingPreviewDiscs, type OpeningPreviewDisc } from "@/lib/mapOpeningPreviewDiscs";
import type { SlimVenue } from "@/lib/venuesSlim";

/**
 * The opening discs for the prerendered /map, read from the very eager cell a
 * first visit loads (MAP_EAGER_VENUE_INDEX_FILE in lib/mapEagerVenueIndexFile.mjs).
 * The path is spelled as literals so Next traces it statically: /map is
 * prerendered and reads it at build, never per request, so it must not join the
 * runtime data packs. __tests__/mapOpeningPreview.test.ts holds the literals to
 * that constant. A file that cannot be read or parsed answers no discs: the map then opens exactly as it did before
 * this preview existed, which is never wrong, only slower.
 */
export async function loadMapOpeningPreview(): Promise<OpeningPreviewDisc[]> {
  try {
    const raw = await readFile(
      join(process.cwd(), "public", "data", "venues_slim.core.json"),
      "utf8",
    );
    const payload = JSON.parse(raw) as { rows?: unknown };
    if (!Array.isArray(payload.rows)) return [];
    return openingPreviewDiscs(payload.rows as SlimVenue[]);
  } catch {
    return [];
  }
}
