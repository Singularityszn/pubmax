export const LONDON_BOX: Readonly<{ minLat: number; maxLat: number; minLng: number; maxLng: number }>;
export function baseVenueIdFor(osmId: unknown): string | null;
export function baseRowOwners(shardBodies: unknown): Map<string, string>;
export function londonBaseVenues(
  seedPubs: unknown,
  options?: {
    box?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
    ownedBy?: ReadonlyMap<string, string>;
  },
): Array<{ id: string; name: string; lat: number; lng: number }>;
export function ownedBaseVenues(
  seedPubs: unknown,
  options?: {
    box?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
    ownedBy?: ReadonlyMap<string, string>;
  },
): Array<{ id: string; name: string; lat: number; lng: number }>;
