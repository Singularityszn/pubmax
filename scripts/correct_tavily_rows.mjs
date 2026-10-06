#!/usr/bin/env node
/**
 * Record the Tavily prices a reviewer corrected, so no later night overwrites
 * them with a new reading.
 *
 *   npm run tavily:correct -- --city=london
 *   npm run tavily:correct -- --city=london --ref=origin/main
 *
 * Edit the price in public/data/drink_price_updates/latest.json first, then run
 * it before you commit. Every city official-site price whose priceGbp differs
 * from the one at --ref (HEAD by default) is listed once in
 * data/enrichment/tavily/<city>/corrected.json. Commit both files together.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCityPubs,
  readCorrectedRows,
  readPriceUpdatesAt,
  recordCorrectedRows,
} from "./enrich_city_pubs_tavily.mjs";
import { venueKeyForOsmPub } from "./lib/tavilyPubEnrichment.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LATEST = "public/data/drink_price_updates/latest.json";

function readArg(name) {
  const arg = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  return arg?.slice(name.length + 1).trim();
}

const city = readArg("--city");
const ref = readArg("--ref") || "HEAD";
if (!city) {
  console.error("Usage: npm run tavily:correct -- --city=london [--ref=<ref before the edit>]");
  process.exit(1);
}

const correctedPath = path.join(ROOT, "data", "enrichment", "tavily", city, "corrected.json");
const before = readCorrectedRows(
  existsSync(correctedPath) ? JSON.parse(readFileSync(correctedPath, "utf8")) : undefined,
);
const rows = recordCorrectedRows(before, {
  beforeUpdates: readPriceUpdatesAt(ref),
  afterUpdates: JSON.parse(readFileSync(path.join(ROOT, LATEST), "utf8")).updates ?? [],
  cityVenueKeys: new Set(loadCityPubs(city).map(venueKeyForOsmPub)),
  correctedAt: new Date().toISOString(),
});

mkdirSync(path.dirname(correctedPath), { recursive: true });
writeFileSync(correctedPath, `${JSON.stringify({ version: 1, rows }, null, 2)}\n`);
console.log(`${city}: ${rows.length - before.length} corrected prices recorded against ${ref}.`);
