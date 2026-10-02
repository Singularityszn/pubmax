export type CityVenueIdSuccession = { from: string; to: string };

export function supersededCityVenueIds(
  cityId: string,
  previousPubs: ReadonlyArray<Record<string, unknown>>,
  nextPubs: ReadonlyArray<Record<string, unknown>>,
): CityVenueIdSuccession[];

export function mergeCityVenueIdAliases(
  aliases: Record<string, string>,
  superseded: ReadonlyArray<CityVenueIdSuccession>,
): Record<string, string>;

export function recordCityVenueIdAliases(
  root: string,
  cityId: string,
  previousPubs: ReadonlyArray<Record<string, unknown>>,
  nextPubs: ReadonlyArray<Record<string, unknown>>,
): Promise<CityVenueIdSuccession[]>;
