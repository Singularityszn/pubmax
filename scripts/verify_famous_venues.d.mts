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

export function parseVerificationLimit(argv: readonly string[]): number | null;

export function remainingBatchSize(limit: number, alreadyVerifiedToday: number): number;

export function idsCoveredByPartialVerifications(
  artifacts: ReadonlyArray<{ verifiedAt?: string; checks?: ReadonlyArray<{ id?: unknown }> }>,
  seedIds: Iterable<string>,
): string[];

export function selectVerificationBatch<
  Entry extends { row: { id: string; observedAt?: string } },
>(
  entries: readonly Entry[],
  options?: { limit?: number | null; skipIds?: Iterable<string> },
): Entry[];
