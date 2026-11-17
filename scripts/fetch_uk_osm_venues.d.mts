export const GREATER_LONDON_BBOX: readonly [number, number, number, number];

export function venuePackPath(group: string): string;
export function manifestPathFor(scope: string): string;

export interface UkVenueRunArtifactPlan {
  complete: boolean;
  packGroups: string[];
  manifestPath: string | null;
  countsPath: string | null;
}

export function packFetchedAt(options: {
  fromRaw: boolean;
  runStartedAt: string;
  chunkStamps: readonly unknown[];
}): string | null;

export function runArtifactPlan(
  scope: string,
  options?: { missingChunks?: number },
): UkVenueRunArtifactPlan;

export function inGreaterLondon(venue: { lat: number; lng: number }): boolean;

export function londonRestaurantSeed(raw: unknown, options?: { allowStale?: boolean }): {
  source: string; license: string; attribution: string; fetchedAt: string;
  bbox: readonly number[];
  venues: Array<{ osmId: string; name: string; amenity: string; lat: number; lng: number;
    address: string | null; cuisine: string | null; openingHours: string | null; kind: string }>;
};

export function restaurantElementsFromGeoJSON(features: unknown[]): Array<{
  type: string; id: number; tags: Record<string, unknown>;
  center: { lat: number; lon: number };
}>;
