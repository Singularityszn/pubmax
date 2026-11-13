type DatasetRow = Record<string, unknown>;

export type PintPricesListing = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  /** The pub page it was read from, or null for a borough map entry. */
  url: string | null;
  pints: Map<string, { pint: string; prices: Set<number> }>;
};

export type UnmatchedListingPint = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  url: string;
  pint: string;
  price: number;
  reason: "no-coordinates" | "outside-london" | "no-matching-venue" | "matches-several-venues" | "venue-already-prices-this-pint";
};

export declare function normaliseKey(...parts: unknown[]): string;
export declare function listingFromPubUrl(value: unknown): { name: string; address: string } | null;
export declare function rowListing(row: DatasetRow): { name: string; address: string } | null;
export declare function rowObservationKey(row: DatasetRow): string | null;
export declare function listingUrl(listing: { name: string; address: string; url?: string | null }): string;
export declare function attachMatchedListings(
  rows: DatasetRow[],
  listings: Map<string, PintPricesListing>,
  collectedAt: string,
): { added: DatasetRow[]; unmatched: UnmatchedListingPint[] };
