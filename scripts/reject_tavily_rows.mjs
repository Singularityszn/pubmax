#!/usr/bin/env node
/**
 * Record a closed nightly Tavily PR's rows as rejected, so no later night
 * writes them again.
 *
 *   npm run tavily:reject -- --city=london --ref=origin/tavily-london/20261006
 *
 * Run it on a branch from the default branch, then commit and merge
 * data/enrichment/tavily/<city>/rejected.json. Every venue page whose rows the
 * closed PR added and the committed data does not hold is listed once.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCityPubs,
  readPriceUpdatesAt,
  readRejectedRows,
  rejectClosedPrRows,
} from "./enrich_city_pubs_tavily.mjs";
import { venueKeyForOsmPub } from "./lib/tavilyPubEnrichment.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LATEST = "public/data/drink_price_updates/latest.json";

function readArg(name) {
  const arg = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  return arg?.slice(name.length + 1).trim();
}

const city = readArg("--city");
const ref = readArg("--ref");
if (!city || !ref) {
  console.error("Usage: npm run tavily:reject -- --city=london --ref=<closed PR branch>");
  process.exit(1);
}

const rejectedPath = path.join(ROOT, "data", "enrichment", "tavily", city, "rejected.json");
const before = readRejectedRows(
  existsSync(rejectedPath) ? JSON.parse(readFileSync(rejectedPath, "utf8")) : undefined,
);
const prUpdates = readPriceUpdatesAt(ref);
const committedUpdates = JSON.parse(readFileSync(path.join(ROOT, LATEST), "utf8")).updates ?? [];
const rows = rejectClosedPrRows(before, {
  prUpdates,
  committedUpdates,
  cityVenueKeys: new Set(loadCityPubs(city).map(venueKeyForOsmPub)),
  rejectedAt: new Date().toISOString(),
});

mkdirSync(path.dirname(rejectedPath), { recursive: true });
writeFileSync(rejectedPath, `${JSON.stringify({ version: 1, rows }, null, 2)}\n`);
console.log(`${city}: ${rows.length - before.length} venue pages rejected from ${ref}.`);
