import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import {
  buildSightings,
  type SightingDTO,
} from "@/lib/feedSightings";
import { stableVenueIdFromKey } from "@/lib/venues";
import { getVenueIndex } from "@/lib/venueIndex";
import { venueMapUrl } from "@/lib/venueMapUrl";

// Server seam for the feed's ambient sightings (lib/feedSightings.ts). Reads the
// same public drink-price overlay the menu surfaces read
// (public/data/drink_price_updates/latest.json), resolves each grouping key to a
// real pub name + "/map?sel=…" link through the bundled venue index (the exact
// path GET /api/pint-drops uses), and hands the /feed server page a small,
// bounded, serialisable list.
//
// Fail-soft throughout: a missing/malformed overlay, or an unreadable venue
// index, yields [] — the feed then falls back to its honest empty state, never
// an error. Memoised per process so repeated renders don't re-read the ~2 MB file.

// The friendly label when a grouping key has no resolvable pub name — kept in
// step with lib/feed.ts VENUE_FALLBACK_LABEL so server and client agree.
const VENUE_FALLBACK_LABEL = "A London pub";

const OVERLAY_PATH = "public/data/drink_price_updates/latest.json";

let cached: Promise<SightingDTO[]> | null = null;

function generatedAtOf(raw: unknown): number {
  const stamp = Date.parse(String((raw as { generatedAt?: unknown })?.generatedAt ?? ""));
  return Number.isFinite(stamp) ? stamp : Date.now();
}

async function build(): Promise<SightingDTO[]> {
  try {
    const file = path.join(process.cwd(), OVERLAY_PATH);
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    const updates = parseDrinkPriceUpdates(raw, generatedAtOf(raw));
    if (updates.length === 0) return [];

    const index = await getVenueIndex();
    return buildSightings(updates, (venueKey) => {
      const venueId = stableVenueIdFromKey(venueKey);
      return {
        venueId,
        venueName: index.get(venueId)?.name ?? VENUE_FALLBACK_LABEL,
        venueMapUrl: venueMapUrl(venueId),
      };
    });
  } catch {
    // Any failure (missing file, bad JSON, unreadable index) → no sightings.
    return [];
  }
}

/** The bounded ambient sightings for the feed's London tab, memoised per process. */
export function loadFeedSightings(): Promise<SightingDTO[]> {
  cached ??= build();
  return cached;
}

/** Test seam: forget the memoised read. */
export function resetFeedSightingsForTests(): void {
  cached = null;
}
