export const PLACES_ENRICHMENT_STAMP: string;
export function placesEnrichmentStamp(pack: {
  inputHash?: string;
  spend?: unknown;
  summary?: unknown;
  venues: readonly { observedAt: string }[];
}): { version: 1; inputHash?: string; observedAt: string | null; spend?: unknown; summary?: unknown };
