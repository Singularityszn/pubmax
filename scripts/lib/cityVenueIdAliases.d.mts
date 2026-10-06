export type CityVenueIdSuccession = { from: string; to: string };

export type RetiredCityVenue = { id: string; name: string; area: string; lat: number; lng: number };

export function venueIdDepartures<T extends Record<string, unknown>>(
  idOf: (pub: T) => string,
  previousPubs: ReadonlyArray<T>,
  nextPubs: ReadonlyArray<T>,
  successorMeters: number,
): Array<{ pub: T; from: string; to: string | null }>;

export function supersededCityVenueIds(
  cityId: string,
  previousPubs: ReadonlyArray<Record<string, unknown>>,
  nextPubs: ReadonlyArray<Record<string, unknown>>,
): CityVenueIdSuccession[];

export function retiredCityVenues(
  city: { id: string; displayName: string },
  previousPubs: ReadonlyArray<Record<string, unknown>>,
  nextPubs: ReadonlyArray<Record<string, unknown>>,
): RetiredCityVenue[];

export function mergeCityVenueIdAliases(
  aliases: Record<string, string>,
  superseded: ReadonlyArray<CityVenueIdSuccession>,
): Record<string, string>;

export function mergeRetiredCityVenues(
  retired: Record<string, Omit<RetiredCityVenue, "id">>,
  departed: ReadonlyArray<RetiredCityVenue>,
  liveIds: ReadonlySet<string>,
): Record<string, Omit<RetiredCityVenue, "id">>;

export function recordCityVenueIdAliases(
  root: string,
  city: { id: string; displayName: string },
  previousPubs: ReadonlyArray<Record<string, unknown>>,
  nextPubs: ReadonlyArray<Record<string, unknown>>,
): Promise<{ superseded: CityVenueIdSuccession[]; retired: RetiredCityVenue[] }>;
