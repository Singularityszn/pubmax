export type FamousVenueOutcome = "confirmed" | "closed" | "unverified";

export type FamousVenueCheck = {
  id: string;
  outcome: FamousVenueOutcome;
};

export function applyVerification<Row extends { id: string }>(
  packs: Map<string, Row[]>,
  checks: readonly FamousVenueCheck[],
  verifiedDay: string,
): Map<string, Array<Row & { observedAt?: string; expiresAt?: string }>>;

export function summarizeVerification(checks: readonly FamousVenueCheck[]): {
  rowsChecked: number;
  confirmed: number;
  closed: string[];
  unverified: string[];
};

export type FamousVenueRow = {
  id: string;
  name: string;
  address: string;
  borough?: string;
  lat?: number;
  lng?: number;
  sourceUrl: string;
  placesNameAliases?: string[];
};

export type PlacesVenueCheck = FamousVenueCheck & {
  method: "places_text_search";
  sourceUrl: string;
  result: string;
  textQuery: string;
  placeId: string | null;
  matchReason: string | null;
  evidenceFetchedAt: string | null;
};

export function verifyRowWithPlaces(
  row: FamousVenueRow,
  searchText: (textQuery: string) => Promise<{
    fetchedAt?: string;
    httpStatus?: number;
    body?: unknown;
  }>,
): Promise<PlacesVenueCheck>;

export function placesCheckAllowsSeedMutation(
  check: {
    outcome: FamousVenueOutcome;
    evidenceFetchedAt?: string | null;
  },
  verifiedDay: string,
): boolean;

export function toCommittedPlacesCheck(check: PlacesVenueCheck): {
  id: string;
  method: "places_text_search";
  sourceUrl: string;
  outcome: FamousVenueOutcome;
  result: string;
  textQuery: string;
  placeId: string | null;
  matchReason: string | null;
  checkedAt: string | null;
};
