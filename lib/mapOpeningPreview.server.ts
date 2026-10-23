import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MAP_OPENING_PREVIEW_CAMERA } from "@/lib/mapOpeningPreview";
import { openingPreviewDiscs, type OpeningPreviewDisc } from "@/lib/mapOpeningPreviewDiscs";
import mapOpeningSnapshot from "@/lib/mapOpeningSnapshot.json";
import {
  resolveOpeningGround,
  type MapOpeningSnapshotMeta,
  type OpeningGround,
} from "@/lib/mapOpeningSnapshot";
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

/**
 * The basemap picture to lay under those discs (lib/mapOpeningSnapshot.ts), or
 * null when the committed snapshot was drawn for another camera than the one a
 * cold first visit opens on. Read from the committed metadata at build, like
 * the discs, so the document names only the picture for its own theme's rule.
 */
export function loadMapOpeningGround(): OpeningGround | null {
  // JSON widens the centre to number[]; __tests__/mapOpeningSnapshot.test.ts
  // holds the file to the shape.
  return resolveOpeningGround(
    mapOpeningSnapshot as unknown as MapOpeningSnapshotMeta,
    MAP_OPENING_PREVIEW_CAMERA,
  );
}
