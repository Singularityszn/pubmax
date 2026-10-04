import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlacesEnrichmentRecord } from "@/lib/placesEnrichment";

let cached: ReadonlyMap<string, PlacesEnrichmentRecord> | undefined;

/** Runtime pack is declared in venueIndexTracing.mjs; source data stays server-side. */
async function loadIndex(): Promise<ReadonlyMap<string, PlacesEnrichmentRecord>> {
  if (cached) return cached;
  try {
    const file = path.join(/* turbopackIgnore: true */ process.cwd(), "data/places_enrichment.json");
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8"));
    if (parsed.version !== 1 || !Array.isArray(parsed.venues)) return new Map();
    const records: PlacesEnrichmentRecord[] = parsed.venues.filter((row: PlacesEnrichmentRecord) =>
      row && typeof row.venueId === "string" && /^[A-Za-z0-9_-]{10,}$/.test(row.googlePlaceId));
    cached = new Map(records.map((row) => [row.venueId, row]));
    return cached;
  } catch { return new Map(); }
}

export async function placesRecordForVenue(venueId: string, osmIds: readonly string[] = []): Promise<PlacesEnrichmentRecord | null> {
  const index = await loadIndex();
  const direct = index.get(venueId);
  if (direct) return direct;
  const refs = [...osmIds, venueId.replace(/^venue-(?:osm|uk)-/, "")]
    .map((id) => id.replace(/^node\//, "n").replace(/^way\//, "w").replace(/^relation\//, "r"));
  const matches = refs.flatMap((ref) => [index.get(`venue-osm-${ref}`), index.get(`venue-uk-${ref}`)])
    .filter((row): row is PlacesEnrichmentRecord => Boolean(row));
  if (new Set(matches.map((row) => row.googlePlaceId)).size !== 1) return null;
  return matches[0] ?? null;
}
