export interface OuterLondonCuratedVenue {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface OuterLondonPub {
  name?: unknown;
  address?: unknown;
  lat: number;
  lng: number;
}

export function outerLondonOwnerForPub(
  pub: OuterLondonPub,
  curatedVenues: OuterLondonCuratedVenue[],
  venueAliases?: Readonly<Record<string, string>>,
): string | null;

export const NEAR_NAME_OWNER_RADIUS_M: number;

export function nearNameOwnerIndex(
  curatedVenues: ReadonlyArray<OuterLondonCuratedVenue>,
  options?: { radiusM?: number },
): (pub: OuterLondonPub) => string | null;
