type LegacyPriceEvidenceRow = {
  price_gbp?: number | null;
  pub_url?: string | null;
  scraped_at_values?: string | null;
};
export declare function legacyPintPriceObservedAt(price: LegacyPriceEvidenceRow): string | null;
export declare function namedLegacyPintPriceSource(price: LegacyPriceEvidenceRow): { label: string; url: string } | null;
export declare function legacyCheapestPriceEvidence(prices: readonly LegacyPriceEvidenceRow[], cheapestPrice: number | null): { priceSource?: string; priceObservedAt?: string };
