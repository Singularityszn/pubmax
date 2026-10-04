import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalOsmId } from "@/lib/harvestFold";
import type { PlacesEnrichmentRecord } from "@/lib/placesEnrichment";

const cached = new Map<string, Promise<readonly PlacesEnrichmentRecord[]>>();

/** Build-generated files keep cold venue requests scoped to their exact OSM identities. */
function recordsForOsmId(key: string): Promise<readonly PlacesEnrichmentRecord[]> {
  const existing = cached.get(key);
  if (existing) return existing;
  const pending = (async () => {
    try {
      const file = path.join(/* turbopackIgnore: true */ process.cwd(), "data/generated/places_enrichment", `${key.replace("/", "-")}.json`);
      const parsed: unknown = JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((row): row is PlacesEnrichmentRecord =>
        row && typeof row.venueId === "string" && canonicalOsmId(row.venueId) === key &&
        typeof row.googlePlaceId === "string" && /^[A-Za-z0-9_-]{10,}$/.test(row.googlePlaceId));
    } catch { return []; }
  })();
  cached.set(key, pending);
  void pending.then((rows) => { if (!rows.length) cached.delete(key); });
  return pending;
}

export async function placesRecordForVenue(venueId: string, osmIds: readonly string[] = []): Promise<PlacesEnrichmentRecord | null> {
  const keys = [...new Set([venueId, ...osmIds].flatMap((id) => canonicalOsmId(id) ?? []))];
  const matches = (await Promise.all(keys.map(recordsForOsmId))).flat();
  if (new Set(matches.map((row) => row.googlePlaceId)).size !== 1) return null;
  return matches[0] ?? null;
}
