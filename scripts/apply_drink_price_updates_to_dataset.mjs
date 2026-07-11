#!/usr/bin/env node
/**
 * Merge Firecrawl drink_price_updates into the canonical app dataset.
 *
 * 1. Adds sourced beer rows to public/data/pint_prices_app_dataset.json
 * 2. Expands public/data/venue_menu_enrichment.json with official menu URLs
 * 3. Rebuilds slim index + venue details (via build_slim)
 *
 * Usage: node scripts/apply_drink_price_updates_to_dataset.mjs [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  stableVenueIdFromKey,
  venueGroupingKey,
} from "./lib/venueMatch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const UPDATES_PATH = join(ROOT, "public", "data", "drink_price_updates", "latest.json");
const DATASET_PATH = join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const ENRICHMENT_PATH = join(ROOT, "public", "data", "venue_menu_enrichment.json");

function parseArgs(argv) {
  return { dryRun: argv.includes("--dry-run") };
}

function nextAppPriceId(rows) {
  let max = 0;
  for (const row of rows) {
    const m = String(row.app_price_id ?? "").match(/app_price_(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function normalisePintName(name) {
  return String(name).trim().toLowerCase();
}

function sourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "official-menu";
  }
}

function enrichmentFromUrl(menuUrl) {
  const host = sourceHost(menuUrl);
  const rec = { source: host, menuUrl };
  if (host.includes("greeneking")) {
    rec.allergyInfoUrl = "https://www.greeneking.co.uk/allergen-information";
    const bookMatch = menuUrl.match(/^(https:\/\/www\.greeneking\.co\.uk\/pubs\/[^/]+\/[^/]+)\//);
    if (bookMatch) {
      rec.bookingUrl = `${bookMatch[1]}/book`;
    }
  }
  return rec;
}

function loadUpdates() {
  const raw = JSON.parse(readFileSync(UPDATES_PATH, "utf8"));
  return Array.isArray(raw) ? raw : (raw.updates ?? []);
}

function buildDatasetIndex(rows) {
  const byVenueKey = new Map();
  const existingBeerKeys = new Set();
  for (const row of rows) {
    const vk = venueGroupingKey({
      pub_name: row.pub_name,
      address: row.address,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    });
    if (!byVenueKey.has(vk)) byVenueKey.set(vk, row);
    existingBeerKeys.add(`${vk}\u0000${normalisePintName(row.pint_name)}`);
  }
  return { byVenueKey, existingBeerKeys };
}

function templateRowFrom(sample) {
  return {
    boroughs_visible: sample.boroughs_visible ?? "",
    boroughs_raw_embedded_non_anomaly: sample.boroughs_raw_embedded_non_anomaly ?? "",
    boroughs_raw_embedded_site_anomaly: sample.boroughs_raw_embedded_site_anomaly ?? "",
    primary_borough: sample.primary_borough ?? "",
    rank_visible_borough: sample.rank_visible_borough ?? "",
    estimated_average_price_text: sample.estimated_average_price_text ?? "",
    pub_url: sample.pub_url ?? "",
    constructed_pub_url: sample.constructed_pub_url ?? "",
    borough_urls: sample.borough_urls ?? "",
    phone_number: sample.phone_number ?? "",
    email: sample.email ?? "",
    website: sample.website ?? "",
    booking_link: sample.booking_link ?? "",
    image_url: sample.image_url ?? "",
    description: sample.description ?? "",
    food: sample.food ?? "",
    cocktails: sample.cocktails ?? "",
    beer_garden: sample.beer_garden ?? "",
    live_sports: sample.live_sports ?? "",
    live_music: sample.live_music ?? "",
    pub_quiz: sample.pub_quiz ?? "",
    darts: sample.darts ?? "",
    pool: sample.pool ?? "",
    happy_hour: sample.happy_hour ?? "",
    karaoke: sample.karaoke ?? "",
    cool: sample.cool ?? "",
    locality: sample.locality ?? "",
    data_quality_notes: sample.data_quality_notes ?? "",
    source_datasets: "firecrawl-official-menu",
    source_row_count: 1,
    visible_borough_source_row_count: 0,
    raw_embedded_source_row_count: 0,
    individual_pub_page_source_row_count: 0,
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: false,
  };
}

function main() {
  const { dryRun } = parseArgs(process.argv);
  const updates = loadUpdates();
  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  if (!Array.isArray(dataset)) throw new Error("dataset must be an array");

  const { byVenueKey, existingBeerKeys } = buildDatasetIndex(dataset);
  let seq = nextAppPriceId(dataset);
  let beerAdded = 0;
  let beerSkipped = 0;

  for (const update of updates) {
    if (update.category !== "beer") continue;
    const sample = byVenueKey.get(update.venueKey);
    if (!sample) {
      beerSkipped += 1;
      continue;
    }
    const dedupeKey = `${update.venueKey}\u0000${normalisePintName(update.drinkName)}`;
    if (existingBeerKeys.has(dedupeKey)) {
      beerSkipped += 1;
      continue;
    }
    existingBeerKeys.add(dedupeKey);
    seq += 1;
    beerAdded += 1;
    const price = Number(update.priceGbp);
    dataset.push({
      ...templateRowFrom(sample),
      app_price_id: `app_price_${String(seq).padStart(6, "0")}`,
      pub_name: sample.pub_name,
      pint_name: update.drinkName,
      price_gbp: price,
      price_text: `£${price.toFixed(2)}`,
      address: sample.address,
      latitude: sample.latitude,
      longitude: sample.longitude,
      comment: `Sourced from ${update.source?.label ?? "official menu"} (${update.observedAt ?? "unknown"}). ${update.source?.url ?? ""}`,
    });
  }

  const enrichment = JSON.parse(readFileSync(ENRICHMENT_PATH, "utf8"));
  enrichment.version = 1;
  enrichment.venues = enrichment.venues ?? {};

  const menuByVenue = new Map();
  for (const update of updates) {
    const url = update.source?.url;
    if (!url) continue;
    const existing = menuByVenue.get(update.venueKey);
    const observedMs = Date.parse(update.observedAt ?? "");
    if (existing && observedMs <= existing.observedMs) continue;
    menuByVenue.set(update.venueKey, { url, observedMs: Number.isFinite(observedMs) ? observedMs : 0 });
  }

  let enrichmentAdded = 0;
  for (const [venueKey, { url }] of menuByVenue.entries()) {
    if (!byVenueKey.has(venueKey)) continue;
    const venueId = stableVenueIdFromKey(venueKey);
    if (enrichment.venues[venueId]?.menuUrl === url) continue;
    enrichment.venues[venueId] = {
      ...enrichment.venues[venueId],
      ...enrichmentFromUrl(url),
    };
    enrichmentAdded += 1;
  }

  console.log(
    `apply: ${updates.length} drink updates → +${beerAdded} beer rows in dataset (${beerSkipped} skipped), ${enrichmentAdded} enrichment venues (${Object.keys(enrichment.venues).length} total)`,
  );

  if (dryRun) {
    console.log("dry-run: no files written");
    return;
  }

  writeFileSync(DATASET_PATH, `${JSON.stringify(dataset, null, 2)}\n`);
  writeFileSync(ENRICHMENT_PATH, `${JSON.stringify(enrichment, null, 2)}\n`);

  execFileSync("node", ["scripts/build_slim_index.mjs"], { stdio: "inherit", cwd: ROOT });
  execFileSync("npm", ["run", "validate-data"], { stdio: "inherit", cwd: ROOT });
}

main();
