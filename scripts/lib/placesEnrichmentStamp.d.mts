type PlacesPack = {
  version: 1;
  inputHash?: string;
  spend?: unknown;
  summary?: unknown;
  venues: readonly { observedAt: string }[];
};
export const PLACES_ENRICHMENT_STAMP: string;
export const PLACES_ENRICHMENT_PACKS: readonly string[];
export function readPlacesEnrichmentPacks(root: string): Record<string, PlacesPack>;
export function placesEnrichmentStamp(packs: Record<string, Omit<PlacesPack, "version">>): {
  version: 1;
  observedAt: string | null;
  packs: Record<string, { inputHash?: string; observedAt: string | null; spend?: unknown; summary?: unknown }>;
};
