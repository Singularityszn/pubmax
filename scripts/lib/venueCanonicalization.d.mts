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
export function significantNameTokens(normName: unknown): string[];
export function cheapSamePubNameCandidate(aNorm: unknown, bNorm: unknown): boolean;
export function namesLikelySamePub(aNorm: unknown, bNorm: unknown): boolean;
export function buildVenueGroupList<T extends CanonicalizationRow>(rows: T[]): Array<
  CanonicalizationRow & {
    key: string;
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    normName: string;
    rowCount: number;
    sourceCount: number;
  }
>;
export function postcodeOutward(address: unknown): string | null;
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number;
export function canonicalizeDataset<T extends CanonicalizationRow>(
  rows: T[],
  options?: {
    maxMergeMeters?: number;
    fuzzyMergeMeters?: number;
    samePubMatch?: (a: object, b: object) => boolean;
  },
): CanonicalizationResult<T>;
export function clusterHasPostcodeConflict(
  cluster: Array<{ address?: unknown }>,
): boolean;
export function mergeAliasMaps(
  prevAliases: Record<string, string> | undefined,
  currentAliases: Record<string, string>,
): Record<string, string>;
