import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MAP_EAGER_VENUE_INDEX_FILE } from "@/lib/mapEagerVenueIndexFile.mjs";
import { openingPreviewDiscs, type OpeningPreviewDisc } from "@/lib/mapOpeningPreviewDiscs";
import type { SlimVenue } from "@/lib/venuesSlim";

/**
 * The opening discs for the prerendered /map, read from the very eager cell a
 * first visit loads (lib/mapEagerVenueIndexFile.mjs). A file that cannot be
 * read or parsed answers no discs: the map then opens exactly as it did before
 * this preview existed, which is never wrong, only slower.
 */
export async function loadMapOpeningPreview(): Promise<OpeningPreviewDisc[]> {
  try {
    const raw = await readFile(
      join(/* turbopackIgnore: true */ process.cwd(), MAP_EAGER_VENUE_INDEX_FILE),
      "utf8",
    );
    const payload = JSON.parse(raw) as { rows?: unknown };
    if (!Array.isArray(payload.rows)) return [];
    return openingPreviewDiscs(payload.rows as SlimVenue[]);
  } catch {
    return [];
  }
}
