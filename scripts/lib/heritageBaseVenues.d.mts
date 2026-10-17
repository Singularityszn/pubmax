export const LONDON_BOX: Readonly<{ minLat: number; maxLat: number; minLng: number; maxLng: number }>;
export function baseVenueIdFor(osmId: unknown): string | null;
export function londonBaseVenues(
  seedPubs: unknown,
  box?: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): Array<{ id: string; name: string; lat: number; lng: number }>;
