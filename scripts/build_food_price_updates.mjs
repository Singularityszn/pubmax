#!/usr/bin/env node
// npm run build:food-price-updates — publish the food lane's reviewed rows.
//
// Reads the candidate rows `npm run harvest:uk-food` appended to
// data-harvest/uk_food/rows.jsonl and publishes them into
// public/data/food_price_updates/ (a dated `prices_YYYYMMDD.json` plus the
// `latest.json` alias the venue Menu tab reads).
//
// FOUR RULES.
// (1) ONLY THE PRICE FACT IS PUBLISHED. The harvest row carries the menu's own
//     words as evidence; the licence allows the price, its date and a link
//     back, so `quote`, `readVia` and `venueId` stay in the harvest ledger.
// (2) A PUB RE-READ IS A PUB RESTATED: every older row for a venue this run
//     priced is replaced, because a dish its menu no longer states is not a
//     dish it serves at that price. A venue this run did not price keeps its
//     rows, each still carrying its own observedAt.
// (3) THE DATE IS DERIVED, NEVER TYPED: `generatedAt` is the newest row's own
//     observedAt.
// (4) A READ WE COULD NOT RUN WRITES NOTHING: no harvested row, or none that
//     passes lib/foodPriceUpdates.ts, refuses and exits non-zero.
//
// Flags: --in <rows.jsonl>, --dry-run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseFoodPriceObservations, parseFoodPriceUpdates } from "../lib/foodPriceUpdates.ts";

const ROOT = process.cwd();
const PACK_DIR = path.join(ROOT, "public/data/food_price_updates");
const DEFAULT_IN = path.join(ROOT, "data-harvest/uk_food/rows.jsonl");

const PACK_COMMENT =
  "Food price updates read from each pub's own first-party menu (npm run harvest:uk-food, published by npm run build:food-price-updates) plus the earlier Greene King import. Attributed use only: price fact, observedAt and a link back.";

/** A harvest row as the pack carries it: the price fact and its provenance. */
export function publishedFoodRow(row) {
  return {
    venueKey: row.venueKey,
    itemName: row.itemName,
    category: row.category,
    priceGbp: row.priceGbp,
    source: { label: row.source?.label, url: row.source?.url, licence: row.source?.licence },
    observedAt: row.observedAt,
  };
}

/**
 * Merge harvested rows into the shipped pack. Pure: returns the envelope and
 * what happened, or throws when there is nothing honest to publish.
 */
export function buildFoodPricePack({ existing, harvested, now = Date.now() }) {
  const candidates = harvested.map(publishedFoodRow);
  const accepted = parseFoodPriceUpdates(candidates, now);
  if (accepted.length === 0) {
    throw new Error(
      harvested.length === 0
        ? "no harvested food rows: run npm run harvest:uk-food first; nothing was written"
        : `none of the ${harvested.length} harvested rows passed lib/foodPriceUpdates.ts; nothing was written`,
    );
  }
  const restated = new Set(accepted.map((row) => row.venueKey));
  const kept = parseFoodPriceObservations(existing, now).filter((row) => !restated.has(row.venueKey));
  const updates = [...kept, ...accepted].sort(
    (a, b) => a.venueKey.localeCompare(b.venueKey) || a.category.localeCompare(b.category) || a.itemName.localeCompare(b.itemName),
  );
  const generatedAt = new Date(Math.max(...updates.map((row) => Date.parse(row.observedAt)))).toISOString();
  return {
    pack: { $comment: PACK_COMMENT, version: 1, generatedAt, updates },
    summary: {
      harvested: harvested.length,
      accepted: accepted.length,
      // Invalid, or superseded by a newer read of the same dish at the same pub.
      notPublished: harvested.length - accepted.length,
      venuesRestated: restated.size,
      rowsKeptFromEarlierReads: kept.length,
      rows: updates.length,
      generatedAt,
    },
  };
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function main() {
  const argv = process.argv.slice(2);
  const inIndex = argv.indexOf("--in");
  const input = inIndex >= 0 ? path.resolve(argv[inIndex + 1]) : DEFAULT_IN;
  const dryRun = argv.includes("--dry-run");
  const latestPath = path.join(PACK_DIR, "latest.json");
  const existing = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, "utf8")) : { updates: [] };
  const { pack, summary } = buildFoodPricePack({ existing, harvested: readJsonl(input) });
  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) return;
  const body = `${JSON.stringify(pack, null, 2)}\n`;
  const dated = path.join(PACK_DIR, `prices_${pack.generatedAt.slice(0, 10).replace(/-/g, "")}.json`);
  writeFileSync(dated, body);
  writeFileSync(latestPath, body);
  console.log(`wrote ${path.relative(ROOT, dated)} and ${path.relative(ROOT, latestPath)}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
