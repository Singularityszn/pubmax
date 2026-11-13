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
import { averagePriceGbp } from "@/lib/pintSavings";
import { listedPriceCohort, listedPriceCohortPrices } from "@/lib/pricedPubCount";
import { isLivePriceRow } from "@/lib/priceRowEligibility.mjs";
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
  /** Cheapest observed pint (GBP), or null when no priced row exists. */
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

// Pure: derive every headline number from raw price rows + two counts. No I/O,
// so it is directly testable and deterministic.
export function computeAboutStats(
  rows: VenuePrice[],
  opts: ComputeOpts,
): AboutStats {
  const safeRows = Array.isArray(rows) ? rows : [];

  // A price observation is any live row with a usable positive numeric price.
  // A superseded row is dated history, never an observation of today.
  const pricedRows = safeRows.filter(
    (row) =>
      isLivePriceRow(row) &&
      typeof row.price_gbp === "number" &&
      Number.isFinite(row.price_gbp) &&
      row.price_gbp > 0,
  );

  // "Pubs tracked" uses the same grouping the app uses everywhere else, so the
  // number on /about matches what a user would count on the map — but only
  // venues carrying at least one accepted price observation qualify.
  const pubs = listedPriceCohort(groupVenuePrices(pricedRows));
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

// Every input below is a file bundled with the deployment, so the answer cannot
// change between two requests to the same instance. The landing page is on the
// per-request render path (the CSP nonce keeps every route dynamic), and the
// raw price read alone is a 6.7 MB JSON.parse, so an unmemoized loader charged
// that parse to EVERY homepage view. Hold the promise, not the value, so
// concurrent first requests share one read instead of racing several.
let cachedStats: Promise<AboutStats> | null = null;

// The loader: reads the real bundled datasets once. A failed price read
// rejects rather than counting zero prices, and the rejection is not
// remembered, so the next request reads again. A page that prints these
// figures says they are unavailable instead.
export function loadAboutStats(): Promise<AboutStats> {
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
  }
}

async function readAboutStats(): Promise<AboutStats> {
  const [historic, rows] = await Promise.all([loadHistoricPubs(), loadPriceRows()]);

  return computeAboutStats(rows, {
    historicPubsCited: historic.length,
    citiesCovered: listEnabledCities().length,
  });
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
