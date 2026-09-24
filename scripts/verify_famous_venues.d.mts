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
  area?: string;
  sourceUrl: string;
  anchor?: { sourceUrl?: string };
  fameGates?: Array<{ sourceUrl: string }>;
};

export function verifyRow(
  row: FamousVenueRow,
  alternates: Map<string, string>,
): Promise<
  FamousVenueCheck & {
    result: string;
    sourceUrl: string;
    verificationSourceUrl?: string;
    closureSourceUrl?: string;
  }
>;

export function verifyRowWithPlaces(
  row: FamousVenueRow,
  searchText: (textQuery: string) => Promise<unknown>,
): Promise<
  FamousVenueCheck & {
    result: string;
    method: string;
    placeId: string | null;
    matchReason: string | null;
    evidenceFetchedAt: string | null;
    evidenceFromLiveCall: boolean;
  }
>;

export function placesCheckAllowsSeedMutation(
  check: {
    outcome: FamousVenueOutcome;
    evidenceFromLiveCall?: boolean;
    evidenceFetchedAt?: string | null;
  },
  verifiedDay: string,
): boolean;

export function toCommittedPlacesCheck(check: Record<string, unknown>): Record<string, unknown>;
