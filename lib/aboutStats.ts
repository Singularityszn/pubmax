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
import { namedLegacyPintPriceSource } from "@/lib/drinks";
import { loadHistoricPubs } from "@/lib/historic";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

export type AboutStats = {
  /** Distinct venues carrying at least one price observation. */
  pubsTracked: number;
  /** Individual observed pint-price readings across all venues. */
  pintPricesObserved: number;
  /** Usable Pint Price rows whose exact row carries a named publisher URL. */
  publisherRecordedPintPrices: number;
  /** Usable Pint Price rows whose exact row carries no named publisher URL. */
  publisherNotRecordedPintPrices: number;
  /** Cheapest observed pint (GBP), or null when no priced row exists. */
  cheapestPint: number | null;
  /** Dearest observed pint (GBP), or null when no priced row exists. */
  dearestPint: number | null;
  /** Mean observed pint (GBP, rounded to pence), or null when none. */
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

  // A price observation is any row with a usable positive numeric price.
  const pricedRows = safeRows.filter(
    (row) =>
      typeof row.price_gbp === "number" &&
      Number.isFinite(row.price_gbp) &&
      row.price_gbp > 0,
  );

  // "Pubs tracked" uses the same grouping the app uses everywhere else, so the
  // number on /about matches what a user would count on the map — but only
  // venues carrying at least one accepted price observation qualify.
  const pubsTracked = groupVenuePrices(pricedRows).length;

  const prices = pricedRows.map((row) => row.price_gbp as number);

  const pintPricesObserved = prices.length;
  const publisherRecordedPintPrices = pricedRows.filter(
    (row) => namedLegacyPintPriceSource(row) !== null,
  ).length;
  const publisherNotRecordedPintPrices =
    pintPricesObserved - publisherRecordedPintPrices;
  const cheapestPint = prices.length ? Math.min(...prices) : null;
  const dearestPint = prices.length ? Math.max(...prices) : null;
  const averagePint = prices.length
    ? Math.round((prices.reduce((sum, p) => sum + p, 0) / prices.length) * 100) / 100
    : null;

  const boroughs = new Set(
    safeRows
      .map((r) => (r.primary_borough ?? "").trim())
      .filter((b) => b.length > 0),
  );

  return {
    pubsTracked,
    pintPricesObserved,
    publisherRecordedPintPrices,
    publisherNotRecordedPintPrices,
    cheapestPint,
    dearestPint,
    averagePint,
    boroughsCovered: boroughs.size,
    historicPubsCited: Math.max(0, opts.historicPubsCited),
    citiesCovered: Math.max(0, opts.citiesCovered),
  };
}

// Async loader: reads the real bundled datasets (defensive — each source
// already returns []/empty on failure, so a missing file degrades to zeroed
// stats rather than crashing the page). getPricedVenues memoizes the grouped
// list, but we re-read the raw rows here for the price-observation count; both
// hit the same cheap bundled JSON.
export async function loadAboutStats(): Promise<AboutStats> {
  const [historic, pricedVenues] = await Promise.all([
    loadHistoricPubs(),
    getPricedVenues(),
  ]);

  // getPricedVenues returns grouped Venue[]; re-read the raw rows for the
  // observation-level counts (cheapest/dearest/average/price count). Reuse the
  // same file path via a light read to keep this module the single source.
  const rows = await loadPriceRows();

  const stats = computeAboutStats(rows, {
    historicPubsCited: historic.length,
    citiesCovered: listEnabledCities().length,
  });

  // If the raw read failed but the grouped venues loaded, fall back to the
  // grouped count so "pubs tracked" is never wrongly zero.
  if (stats.pubsTracked === 0 && pricedVenues.length > 0) {
    return { ...stats, pubsTracked: pricedVenues.length };
  }
  return stats;
}

async function loadPriceRows(): Promise<VenuePrice[]> {
  try {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const file = path.join(
      process.cwd(),
      "public",
      "data",
      "pint_prices_app_dataset.json",
    );
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as VenuePrice[]) : [];
  } catch {
    return [];
  }
}
