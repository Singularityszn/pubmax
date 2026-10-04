import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalOsmId } from "@/lib/harvestFold";
import type { PlacesEnrichmentRecord } from "@/lib/placesEnrichment";

let cached: ReadonlyMap<string, readonly PlacesEnrichmentRecord[]> | undefined;

/** Runtime pack is declared in venueIndexTracing.mjs; source data stays server-side. Keyed by canonical OSM id. */
async function loadIndex(): Promise<ReadonlyMap<string, readonly PlacesEnrichmentRecord[]>> {
  if (cached) return cached;
  try {
    const file = path.join(/* turbopackIgnore: true */ process.cwd(), "data/places_enrichment.json");
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8"));
    if (parsed.version !== 1 || !Array.isArray(parsed.venues)) return new Map();
    const index = new Map<string, PlacesEnrichmentRecord[]>();
    for (const row of parsed.venues as PlacesEnrichmentRecord[]) {
      if (!row || typeof row.venueId !== "string" || !/^[A-Za-z0-9_-]{10,}$/.test(row.googlePlaceId)) continue;
      const key = canonicalOsmId(row.venueId);
      if (key) index.set(key, [...(index.get(key) ?? []), row]);
    }
    cached = index;
    return cached;
  } catch { return new Map(); }
}

export async function placesRecordForVenue(venueId: string, osmIds: readonly string[] = []): Promise<PlacesEnrichmentRecord | null> {
  const index = await loadIndex();
  const matches = [...new Set([venueId, ...osmIds].flatMap((id) => canonicalOsmId(id) ?? []))]
    .flatMap((key) => index.get(key) ?? []);
  if (new Set(matches.map((row) => row.googlePlaceId)).size !== 1) return null;
  return matches[0] ?? null;
}
