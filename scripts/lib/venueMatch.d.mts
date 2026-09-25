export type VenueDatasetRow = {
  pub_name: string;
  address: string;
  latitude: number;
  longitude: number;
  [key: string]: unknown;
};

export type VenueIndexes<T extends VenueDatasetRow = VenueDatasetRow> = {
  idToKey: Map<string, string>;
  nameToKeys: Map<string, string[]>;
  rowsByKey: Map<string, T>;
};

export type DrinkUpdateRow = {
  venueKey: string;
  drinkName: string;
  category: string;
  source?: { label?: string; url?: string } | null;
  [key: string]: unknown;
};

export function normaliseVenueKeyPart(value: string): string;
export function venueGroupingKey(row: VenueDatasetRow): string;
export function stableVenueIdFromKey(key: string): string;
export function normalisePubName(name: string): string;
export function buildVenueIndexes<T extends VenueDatasetRow>(dataset: readonly T[]): VenueIndexes<T>;
export function menuUrlToVenueId(enrichment: {
  venues?: Record<string, { menuUrl?: string }>;
}): Map<string, string>;
export const GK_SLUG_HINTS: Readonly<Record<string, readonly string[]>>;
export function resolveVenueKeyFromHints(hints: readonly string[] | null | undefined, indexes: VenueIndexes): string | null;
export function resolveVenueKeyFromPubName(pubName: string | null | undefined, indexes: VenueIndexes): string | null;
export function slugFromMbplcDrinksUrl(url: string): string | null;
export function mergeDrinkUpdates<T extends DrinkUpdateRow>(existing: readonly T[], incoming: readonly T[]): T[];
