export function hostOfWebsite(website: string): string | null;

export function filterHostEntriesToGreaterLondon<T extends { pubs?: Array<{ lat?: number; lng?: number }> }>(
  hostEntries: T[],
): T[];

export function venueCoordsFromSlim(filePath?: string): Map<string, { lat: number; lng: number }>;

export function applyMenuEnrichmentSeeds(
  hostEntries: Array<{ host: string; origin?: string; seedPages?: string[] }>,
  options: {
    enrichmentPath?: string;
    coordsByVenueId: Map<string, { lat: number; lng: number }>;
    isHarvestableOperatorUrl: (url: string) => boolean;
  },
): { seeded: number; venuesConsidered: number; onUnknownHost: number; refused: number };
