export type UkBaseIdSuccession = { from: string; to: string };

export type RetiredUkBaseVenue = { id: string; name: string; area: string; lat: number; lng: number };

export function ukBaseIdDepartures(
  previousRows: ReadonlyArray<ReadonlyArray<unknown>>,
  nextRows: ReadonlyArray<ReadonlyArray<unknown>>,
  liveCuratedIds: ReadonlySet<string>,
): Array<{
  pub: {
    osmId: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    curatedVenueId: string;
  };
  from: string;
  to: string | null;
}>;

export function recordUkBaseVenueIdAliases(
  root: string,
  previousRows: ReadonlyArray<ReadonlyArray<unknown>>,
  nextRows: ReadonlyArray<ReadonlyArray<unknown>>,
  liveCuratedIds: ReadonlySet<string>,
): Promise<{ superseded: UkBaseIdSuccession[]; retired: RetiredUkBaseVenue[] }>;
