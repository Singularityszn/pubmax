#!/usr/bin/env node
/**
 * Re-read first-party menu URLs already in site_harvest.jsonl and attach
 * drinkLabel from the shared ukPriceCrawl reader without a full host re-crawl.
 *
 *   node scripts/backfill_site_harvest_drink_labels.mjs [--dry-run] [--limit N]
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { pdfIsWorthReading, readPdfText } from "../lib/harvest/pdfText.ts";
import {
  cheapestPerCategory,
  pageStatesADrinksList,
  readVenueDrinkPrices,
} from "../lib/harvest/ukPriceCrawl.ts";
import { isHarvestableOperatorUrl } from "../lib/harvest/sourcePolicy.ts";

const ROOT = process.cwd();
const ROWS_PATH = path.join(ROOT, "data/uk_prices/site_harvest.jsonl");
const USER_AGENT = "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";
const TIMEOUT_MS = 25_000;

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  if (i === -1) return Infinity;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : Infinity;
})();

function loadRows() {
  return readFileSync(ROWS_PATH, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

async function fetchBody(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html,application/xhtml+xml,application/pdf", "user-agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return { ok: false, body: "" };
    const type = response.headers.get("content-type") ?? "";
    const body = await response.text();
    if (/pdf/i.test(type) || url.toLowerCase().includes(".pdf")) {
      if (!pdfIsWorthReading(body)) return { ok: false, body: "" };
      const text = await readPdfText(body);
      return { ok: Boolean(text), body: text ?? "" };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

function pricedRowsFromHtml(html) {
  const reading = readVenueDrinkPrices(html);
  if (!pageStatesADrinksList(reading)) return [];
  return cheapestPerCategory(reading);
}

async function main() {
  const rows = loadRows();
  const needLabel = rows.filter((row) => !row.drinkLabel);
  const urls = [...new Set(needLabel.map((row) => row.sourceUrl).filter(Boolean))];
  const slice = urls.slice(0, LIMIT);
  console.log(
    `backfill drinkLabel: ${needLabel.length} row(s) missing label across ${urls.length} URL(s); fetching ${slice.length}`,
  );

  const cache = new Map();
  for (const url of slice) {
    try {
    if (!isHarvestableOperatorUrl(url)) {
      console.log(`  skip refused ${url}`);
      continue;
    }
    const fetched = await fetchBody(url);
    if (!fetched.ok) {
      console.log(`  skip unreadable ${url}`);
      continue;
    }
    cache.set(url, pricedRowsFromHtml(fetched.body));
    } catch (error) {
      console.log(`  skip error ${url}: ${String(error).slice(0, 120)}`);
    }
  }

  let labeled = 0;
  for (const row of rows) {
    if (row.drinkLabel) continue;
    const priced = cache.get(row.sourceUrl);
    if (!priced?.length) continue;
    const matches = priced.filter(
      (candidate) => candidate.category === row.category && candidate.priceGbp === row.priceGbp,
    );
    if (matches.length !== 1 || !matches[0].drinkLabel) continue;
    row.drinkLabel = matches[0].drinkLabel;
    labeled += 1;
  }

  console.log(`  attached drinkLabel on ${labeled} row(s)`);
  if (!DRY_RUN && labeled > 0) {
    writeFileSync(ROWS_PATH, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  }
}

await main();
