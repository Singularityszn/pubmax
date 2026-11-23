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
// datasets. The average and its pub count use lib/pricedPubCount.ts.
// The loader takes its minimum from lib/cheapestHunt.server.ts.

import { listEnabledCities } from "@/lib/cities";
import { loadHistoricPubs } from "@/lib/historic";
import { averagePriceGbp } from "@/lib/pintSavings";
import { loadLondonHuntPintsOrNull } from "@/lib/cheapestHunt.server";
import { listedPriceCohort, listedPriceCohortPrices } from "@/lib/pricedPubCount";
import { isLivePintPriceRow } from "@/lib/priceRowEligibility.mjs";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

export type AboutStats = {
  /**
   * The pubs the average is taken over: pubs in our London pub list with a
   * listed cheapest pint (`listedPriceCohort`, lib/pricedPubCount.ts), the same
   * cohort the landing's average names. NOT the count of pubs with any pint
   * price on record; that is `pricedPubCount`, which /about reads separately.
   */
  pubsTracked: number;
  /** Individual observed pint-price readings across all venues. */
  pintPricesObserved: number;
  /**
   * Row minimum (GBP) from computeAboutStats. loadAboutStats replaces it with
   * the London hunt minimum, or null when the hunt is unavailable or has no eligible pints.
   */
  cheapestPint: number | null;
  /** Dearest observed pint (GBP), or null when no priced row exists. */
  dearestPint: number | null;
  /**
   * Mean of each tracked pub's cheapest pint (GBP, rounded to pence), or null
   * when none. The SAME cohort and the same arithmetic as the landing's
   * "average listed pint across N pubs" (`listedPriceCohortPrices` in
   * lib/pricedPubCount.ts and `averagePriceGbp` in lib/pintSavings.ts), taken over the same
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

// Pure row statistics. The loader supplies the hunt's headline minimum.
export function computeAboutStats(
  rows: VenuePrice[],
  opts: ComputeOpts,
): AboutStats {
  const safeRows = Array.isArray(rows) ? rows : [];

  // A pint price observation is any live pint row with a usable positive numeric
  // price. A superseded row is dated history, and a bottle is not a pint.
  const pricedRows = safeRows.filter(
    (row) =>
      isLivePintPriceRow(row) &&
      typeof row.price_gbp === "number" &&
      Number.isFinite(row.price_gbp) &&
      row.price_gbp > 0,
  );

  const pubs = listedPriceCohort(groupVenuePrices(safeRows));
  const pubsTracked = pubs.length;

  const prices = pricedRows.map((row) => row.price_gbp as number);

  const pintPricesObserved = prices.length;
  const cheapestPint = prices.length ? Math.min(...prices) : null;
  const dearestPint = prices.length ? Math.max(...prices) : null;
  const averagePint = averagePriceGbp(listedPriceCohortPrices(pubs));

  const boroughs = new Set(
    safeRows
      .map((r) => (r.primary_borough ?? "").trim())
      .filter((b) => b.length > 0),
  );

  return {
    pubsTracked,
    pintPricesObserved,
    cheapestPint,
    dearestPint,
    averagePint,
    boroughsCovered: boroughs.size,
    historicPubsCited: Math.max(0, opts.historicPubsCited),
    citiesCovered: Math.max(0, opts.citiesCovered),
  };
}

// Cache successful bundled reads. Hold the promise, not the value, so
// concurrent first requests share one read instead of racing several.
let cachedStats: Promise<AboutStats> | null = null;

// The loader: reads the real bundled datasets once. A failed price read
// rejects rather than counting zero prices, and the rejection is not
// remembered, so the next request reads again. A page that prints these
// figures says they are unavailable instead.
// An unavailable hunt omits only cheapestPint and clears the cache for a retry.
export function loadAboutStats(): Promise<AboutStats> {
  cachedStats ??= readAboutStats().then(({ stats, huntAvailable }) => {
    if (!huntAvailable) cachedStats = null;
    return stats;
  }).catch((error) => {
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
  }
}

async function readAboutStats(): Promise<{ stats: AboutStats; huntAvailable: boolean }> {
  const [historic, rows, hunt] = await Promise.all([loadHistoricPubs(), loadPriceRows(), loadLondonHuntPintsOrNull()]);

  return {
    stats: {
      ...computeAboutStats(rows, {
        historicPubsCited: historic.length,
        citiesCovered: listEnabledCities().length,
      }),
      cheapestPint: hunt?.[0]?.priceGbp ?? null,
    },
    huntAvailable: hunt !== null,
  };
}

async function loadPriceRows(): Promise<VenuePrice[]> {
  const { promises: fs } = await import("fs");
  const path = await import("path");
  const file = path.join(
    process.cwd(),
    "public",
    "data",
    "pint_prices_app_dataset.json",
  );
  const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("pint_prices_app_dataset.json is not a list of price rows");
  return parsed as VenuePrice[];
}
