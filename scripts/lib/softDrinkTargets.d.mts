export type SoftDrinkVenueRow = {
  pub_name: string;
  latitude: number;
  longitude: number;
  primary_borough?: string | null;
};

export type SoftDrinkVenueIndexes = {
  idToKey: ReadonlyMap<string, string>;
  rowsByKey: ReadonlyMap<string, SoftDrinkVenueRow>;
};

export type CuratedSoftDrinkTarget = {
  url: string;
  pubName: string;
  venueId: string;
  venueKey: string;
  locality: string | null;
  host: string;
};

export function buildCuratedSoftDrinkTargets(input: {
  chain: string;
  enrichment?: {
    venues?: Record<string, { source?: string; menuUrl?: string }>;
  };
  indexes: SoftDrinkVenueIndexes;
  inGreaterLondon: (point: { lat: number; lng: number }) => boolean;
}): CuratedSoftDrinkTarget[];

export function selectCuratedSoftDrinkTargets(
  targets: readonly CuratedSoftDrinkTarget[],
  options?: { urlsFileText?: string; limit?: number },
): CuratedSoftDrinkTarget[];
