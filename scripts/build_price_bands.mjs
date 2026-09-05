#!/usr/bin/env node
// Cut the price-band thresholds from the shipped city packs, and write them once.
//
//   npm run build:price-bands
//
// THE RULE LIVES IN lib/priceBand.ts (`priceBandThresholdsFrom`), and this
// script only feeds it and writes the answer, so the producer and the reader
// cannot disagree about what a tercile is. The input is every enabled city
// pack in lib/cityVenuePacks.mjs: a pub-kind row with a numeric cheapestPrice
// is one priced pub, and a famous venue's anchor price (a cocktail, a course)
// is not a pint and is left out. A city under MIN_PRICE_BAND_SAMPLE priced
// pubs gets no row of its own and reads the `all` row at runtime; its sample
// size is still written down, so the day a second city earns a basis the
// table says so in the diff.
//
// Runs under tsx because the rule is TypeScript. __tests__/priceBand.test.ts
// recomputes this file from the same packs and fails when they drift.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { CITY_VENUE_PACKS } from "../lib/cityVenuePacks.mjs";
import { MIN_PRICE_BAND_SAMPLE, priceBandThresholdsFrom } from "../lib/priceBand.ts";
import { isPubVenueKind } from "../lib/venueKindFilters.ts";

export const PRICE_BANDS_PATH = path.join("public", "data", "price_bands", "thresholds.json");

/** Pint prices per enabled city, read from the packs on disk. */
export async function readCityPintPrices(root = process.cwd()) {
  const byCity = new Map();
  for (const [cityId, pack] of Object.entries(CITY_VENUE_PACKS)) {
    if (!pack.enabled) continue;
    const file = path.join(root, "public", pack.slimVenuesPath);
    const payload = JSON.parse(await readFile(file, "utf8"));
    const rows = Array.isArray(payload) ? payload : payload.rows ?? [];
    const prices = [];
    for (const row of rows) {
      if (!isPubVenueKind(row.kind)) continue;
      if (typeof row.cheapestPrice !== "number" || !Number.isFinite(row.cheapestPrice)) continue;
      if (row.cheapestPrice <= 0) continue;
      prices.push(row.cheapestPrice);
    }
    byCity.set(cityId, prices);
  }
  return byCity;
}

/** The table lib/priceBand.ts reads. Pure over the per-city price lists. */
export function buildPriceBandTable(byCity, minSample = MIN_PRICE_BAND_SAMPLE) {
  const all = priceBandThresholdsFrom([...byCity.values()].flat(), minSample);
  if (!all) {
    throw new Error(
      `price bands: fewer than ${minSample} priced pubs across every pack, refusing to write a table`,
    );
  }
  const cities = {};
  const sampleSizes = {};
  for (const [cityId, prices] of [...byCity.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    sampleSizes[cityId] = prices.length;
    const own = priceBandThresholdsFrom(prices, minSample);
    if (own) cities[cityId] = own;
  }
  return { rule: "terciles", minSample, all, cities, sampleSizes };
}

async function main() {
  const table = buildPriceBandTable(await readCityPintPrices());
  const target = path.join(process.cwd(), PRICE_BANDS_PATH);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(table, null, 2)}\n`);
  console.log(
    `price bands: all ${table.all.sampleSize} pubs, cheap ≤ £${table.all.cheapMaxGbp}, average ≤ £${table.all.averageMaxGbp}; own basis: ${Object.keys(table.cities).join(", ") || "none"}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
