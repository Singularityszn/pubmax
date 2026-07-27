export type CityVenuePack = {
  readonly slimVenuesPath: string;
  readonly enabled: boolean;
};

export const CITY_VENUE_PACKS: Record<string, CityVenuePack>;

export function enabledVenuePackIncludes(): string[];
