/** The small committed head the freshness spine dates google_places_content from, so no request parses the full Places pack. */
export const PLACES_ENRICHMENT_STAMP = "data/places_enrichment_stamp.json";

/** Derived from the pack alone: the oldest copied row dates it, and spend and summary travel with it. */
export function placesEnrichmentStamp(pack) {
  return { version: 1, inputHash: pack.inputHash, observedAt: pack.venues.map((row) => row.observedAt).sort()[0] ?? null,
    spend: pack.spend, summary: pack.summary };
}
