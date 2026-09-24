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

export type FamousVenueRow = {
  id: string;
  name: string;
  address: string;
  borough?: string;
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
