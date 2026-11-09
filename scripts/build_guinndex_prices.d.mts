export type GuinndexVenueCandidate = {
  venueId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

export declare function writeGuinndexCache(
  dir: string,
  kind: "county" | "pub",
  key: string,
  value: unknown,
): void;

export declare function venueCandidates(input: {
  baseRows: ReadonlyArray<ReadonlyArray<unknown>>;
  slimRows: ReadonlyArray<Record<string, unknown>>;
}): GuinndexVenueCandidate[];

export declare function indexCandidates(candidates: ReadonlyArray<GuinndexVenueCandidate>): Map<string, unknown[]>;

export declare function matchGuinndexPub(
  pub: Record<string, unknown>,
  grid: Map<string, unknown[]>,
):
  | { ok: true; venueId: string; venueName: string; metres: number }
  | { ok: false; reason: "no-identity" | "no-venue" | "ambiguous" };
