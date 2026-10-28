import "server-only";

// About-page traction stats — the ONLY numbers shown on /about are derived here,
// at build/request time, from the same bundled datasets the rest of the app
// reads (public/data/pint_prices_app_dataset.json + historic_pubs.json) and the
// enabled-city config. Nothing is invented: no users, no revenue, no growth
// curve — just what the provenance-honest data can support. This mirrors the
// ethos in PRODUCT.md / CONTEXT.md (provenance-first, never fabricate facts).
//
// Split into a PURE `computeAboutStats(rows, opts)` (unit-tested against tiny
// fixtures) and an async `loadAboutStats()` loader that wires in the real
// datasets. Reuses groupVenuePrices so "pubs tracked" is counted the exact same
// way the map/discovery surfaces count a venue.

import { listEnabledCities } from "@/lib/cities";
import { loadHistoricPubs } from "@/lib/historic";
import { computePublicPriceStats } from "@/lib/publicPriceStats";
import { loadPublicPriceStats, resetPublicPriceStatsForTests } from "@/lib/publicPriceStats.server";
import type { VenuePrice } from "@/lib/venues";

export type AboutStats = {
  /** Distinct venues carrying at least one price observation. */
  pubsTracked: number;
  /** Individual observed pint-price readings across all venues. */
  pintPricesObserved: number;
  /** Cheapest observed pint (GBP), or null when no priced row exists. */
  cheapestPint: number | null;
  /** Dearest observed pint (GBP), or null when no priced row exists. */
  dearestPint: number | null;
  /**
   * Mean of each tracked pub's cheapest pint (GBP, rounded to pence), or null
   * when none. The SAME cohort and the same arithmetic as the landing's
   * "average listed pint across N pubs" (`pubCheapestPrices` and
   * `averagePriceGbp` in lib/pintSavings.ts), taken over the same
   * `pubsTracked` pubs, so the two pages print one number. It used to be the
   * mean of every reading, which counted a pub with five pints five times and
   * printed £5.72 beside the landing's £5.54 (site review, 18 Oct 2026).
   */
  averagePint: number | null;
  /** Distinct London boroughs & named neighbourhoods present in the data. */
  boroughsCovered: number;
  /** Historic pubs with a cited (Wikipedia/Wikidata) fact. */
  historicPubsCited: number;
  /** Browseable UK cities shipped in the app. */
  citiesCovered: number;
};

type ComputeOpts = {
  historicPubsCited: number;
  citiesCovered: number;
};

// Pure: derive every headline number from raw price rows + two counts. No I/O,
// so it is directly testable and deterministic.
export function computeAboutStats(
  rows: VenuePrice[],
  opts: ComputeOpts,
): AboutStats {
  const { venues: _venues, averages: _averages, ...prices } = computePublicPriceStats(rows);
  return {
    ...prices,
    historicPubsCited: Math.max(0, opts.historicPubsCited),
    citiesCovered: Math.max(0, opts.citiesCovered),
  };
}

// The public price snapshot owns the bundled read. This promise also shares
// the independent historic and enabled-city counts between callers.
let cachedStats: Promise<AboutStats> | null = null;

// The loader: reads the real bundled datasets (defensive — each source already
// returns []/empty on failure, so a missing file degrades to zeroed stats
// rather than crashing the page), once.
export function loadAboutStats(): Promise<AboutStats> {
  // A rejection must not be remembered: every read below is already fail-soft,
  // so a throw here means something unexpected, and the next request deserves a
  // fresh attempt rather than a permanently poisoned figure.
  cachedStats ??= readAboutStats().catch((error) => {
    cachedStats = null;
    throw error;
  });
  return cachedStats;
}

/** Test-only: drop the memoized figures between hermetic cases. */
export function resetAboutStatsForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cachedStats = null;
    resetPublicPriceStatsForTests();
  }
}

async function readAboutStats(): Promise<AboutStats> {
  const [historic, snapshot] = await Promise.all([
    loadHistoricPubs(),
    loadPublicPriceStats(),
  ]);
  const { venues: _venues, averages: _averages, ...prices } = snapshot;
  return {
    ...prices,
    historicPubsCited: historic.length,
    citiesCovered: listEnabledCities().length,
  };
}
