import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The small committed head the freshness spine dates google_places_content from, so no request parses a full Places pack. */
export const PLACES_ENRICHMENT_STAMP = "data/places_enrichment_stamp.json";

/** Every published Places pack, London first; the runtime builder and the stamp read this one list. */
export const PLACES_ENRICHMENT_PACKS = ["places_enrichment", "places_enrichment_uk_cities", "places_enrichment_london_extras", "places_enrichment_uk_cities_extras"];

/** The committed packs that exist, keyed by name. */
export function readPlacesEnrichmentPacks(root) {
  const packs = {};
  for (const name of PLACES_ENRICHMENT_PACKS) {
    const file = join(root, `data/${name}.json`);
    if (!existsSync(file)) continue;
    const pack = JSON.parse(readFileSync(file, "utf8"));
    if (pack.version !== 1 || !Array.isArray(pack.venues)) throw new Error("Invalid Places enrichment pack");
    packs[name] = pack;
  }
  return packs;
}

const oldest = (venues) => venues.map((row) => row.observedAt).sort()[0] ?? null;

/** Derived from the packs alone: the oldest copied row across every pack dates it, and each pack's spend and summary travel with it. */
export function placesEnrichmentStamp(packs) {
  return { version: 1, observedAt: oldest(Object.values(packs).flatMap((pack) => pack.venues)),
    packs: Object.fromEntries(Object.entries(packs).map(([name, pack]) =>
      [name, { inputHash: pack.inputHash, observedAt: oldest(pack.venues), spend: pack.spend, summary: pack.summary }])) };
}
