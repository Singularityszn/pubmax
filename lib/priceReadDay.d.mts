// Hand-written types for lib/priceReadDay.mjs (allowJs is off). Keep in lockstep.

export declare function priceRowReadDay(row: { scraped_at_values?: unknown } | null | undefined): string | null;
export declare function cheapestPriceReadDay(
  rows: readonly { price_gbp?: unknown; scraped_at_values?: unknown }[],
  cheapestPrice: number | null | undefined,
): string | null;
