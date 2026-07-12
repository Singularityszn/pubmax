// Hand-written types for the plain-JS canonicalization module (allowJs is off,
// so tsc needs a declaration to typecheck the unit tests that import it). Keep
// in lockstep with scripts/lib/venueCanonicalization.mjs.

export interface CanonicalizationRow {
  pub_name?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  source_datasets?: unknown;
  [key: string]: unknown;
}

export interface CanonicalizationCluster {
  canonicalId: string;
  canonicalName: string;
  mergedFrom: Array<{ id: string; name: string; rows: number }>;
}

export interface CanonicalizationStats {
  inputRows: number;
  venueIdentitiesBefore: number;
  duplicateClusters: number;
  mergedRecords: number;
  venueIdentitiesAfter: number;
}

export interface CanonicalizationResult<T> {
  rows: T[];
  aliases: Record<string, string>;
  clusters: CanonicalizationCluster[];
  stats: CanonicalizationStats;
}

export function normaliseVenueKeyPart(value: unknown): string;
export function venueGroupingKey(row: CanonicalizationRow): string;
export function stableVenueIdFromKey(key: string): string;
export function hasOperatorSuffix(name: unknown): boolean;
export function normalizeVenueIdentityName(name: unknown): string;
export function postcodeOutward(address: unknown): string | null;
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number;
export function canonicalizeDataset<T extends CanonicalizationRow>(
  rows: T[],
  options?: { maxMergeMeters?: number },
): CanonicalizationResult<T>;
