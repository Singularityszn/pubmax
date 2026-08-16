import "server-only";

// Server-safe permissible-source price collection for scheduled refreshes.
//
// Source-specific fetchers AND the allowlist filter are shared with
// scripts/refresh_prices.mjs (scripts/price_source_fetchers.mjs owns both), so
// the scheduled path can never accept a source the manual path would skip. This
// module owns row validation so a Vercel cron can exercise the same source
// boundary without trying to write to its read-only deployment filesystem or
// open a GitHub pull request.

import priceSourceRegistry from "@/data/price_sources.json";
import {
  fetchFromSource,
  filterPermissiblePriceSources,
  type PermissiblePriceSource,
} from "@/scripts/price_source_fetchers.mjs";
import { isValidPriceUpdate, type PriceUpdate } from "@/lib/priceUpdates";

type PriceSourceFetcher = (
  source: PermissiblePriceSource,
) => Promise<unknown>;

export type FailedPriceSource = {
  id: string;
  error: string;
};

export type PriceRefreshResult = {
  updates: PriceUpdate[];
  fetchedRows: number;
  droppedRows: number;
  sourcesChecked: number;
  failedSources: FailedPriceSource[];
};

export type PriceRefreshDeps = {
  fetchSource?: PriceSourceFetcher;
  now?: number;
};

function permissibleSources(): PermissiblePriceSource[] {
  return filterPermissiblePriceSources(priceSourceRegistry.sources, {
    onSkip: (message) => console.warn(`[cron:refresh-prices] ${message}`),
  });
}

/**
 * Retrieve and validate current rows from every permissible source.
 *
 * Empty is supported while source parsers remain stubbed. Each provider
 * failure is recorded so one bad source cannot starve remaining sources.
 */
export async function fetchPriceUpdates(
  deps: PriceRefreshDeps = {},
): Promise<PriceRefreshResult> {
  const sources = permissibleSources();
  const fetchSource = deps.fetchSource ?? fetchFromSource;
  const now = deps.now ?? Date.now();
  const rawRows: unknown[] = [];
  const failedSources: FailedPriceSource[] = [];

  for (const source of sources) {
    try {
      const rows = await fetchSource(source);
      if (!Array.isArray(rows)) {
        throw new Error(
          `Price source "${source.id}" returned a non-array payload.`,
        );
      }
      rawRows.push(...rows);
    } catch (err) {
      failedSources.push({
        id: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const updates = rawRows.filter((row): row is PriceUpdate =>
    isValidPriceUpdate(row, now),
  );

  return {
    updates,
    fetchedRows: rawRows.length,
    droppedRows: rawRows.length - updates.length,
    sourcesChecked: sources.length,
    failedSources,
  };
}
