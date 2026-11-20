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
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { openingPricedVenues, type OpeningPricedVenue } from "@/lib/mapOpeningPricedVenues";
import { EXPECTED_MAP_DATA_REVISION } from "@/lib/mapDataRevision";
import { readVenueDetailBase } from "@/lib/venueDetailArtifact.server";
import { openingPriceEvidence } from "@/lib/mapOpeningPriceEvidence";

/**
 * The opening discs for prerendered /map and home, read from the eager cell a
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
    const rows = rowsFromSlimPayload(JSON.parse(raw));
    if (!rows) return [];
    return openingPreviewDiscs(rows as SlimVenue[]);
  } catch {
    return [];
  }
}

export async function loadOpeningPricedVenues(): Promise<(OpeningPricedVenue & NonNullable<ReturnType<typeof openingPriceEvidence>>)[]> {
  try {
    const payload = JSON.parse(await readFile(join(process.cwd(), "public", "data", "venues_slim.core.json"), "utf8"));
    if (EXPECTED_MAP_DATA_REVISION && payload.revision !== EXPECTED_MAP_DATA_REVISION) return [];
    const rows = rowsFromSlimPayload(payload) as SlimVenue[] | null;
    if (!rows || typeof payload.d !== "string" || !payload.d) return [];
    const evidence = new Map<string, NonNullable<ReturnType<typeof openingPriceEvidence>>>();
    await Promise.all(rows.map(async (row) => {
      if (typeof row.id !== "string" || typeof row.cheapestPrice !== "number") return;
      const detail = await readVenueDetailBase(row.id, row);
      if (!detail || detail.venue.id !== row.id || detail.venue.cheapestPrice !== row.cheapestPrice) return;
      const priced = openingPriceEvidence(row.cheapestPrice, detail.venue.prices, payload.d, detail.priceDatasetDigest ?? "");
      if (priced && ((row.priceSource && row.priceSource !== priced.source) || (row.priceObservedAt && row.priceObservedAt !== priced.date))) return;
      if (priced) evidence.set(row.id, priced);
    }));
    return openingPricedVenues(rows.filter((row) => evidence.has(row.id))).flatMap((pin) => {
      const priced = evidence.get(pin.id);
      return priced ? [{ ...pin, ...priced }] : [];
    });
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
