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
import { fileURLToPath } from "node:url";

import { pdfIsWorthReading, readPdfText } from "../lib/harvest/pdfText.ts";
import { createRobotsChecker } from "../lib/harvest/robots.ts";
import {
  cheapestPerCategory,
  pageStatesADrinksList,
  readVenueDrinkPrices,
} from "../lib/harvest/ukPriceCrawl.ts";
import { harvestRedirectLanding, isHarvestableOperatorUrl } from "../lib/harvest/sourcePolicy.ts";

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

/**
 * Re-read one first-party menu URL, asking permission first and again about
 * wherever a redirect landed.
 *
 * A PDF IS BYTES, NOT TEXT. Decoding one through `response.text()` corrupts the
 * binary, and handing that string to `pdfIsWorthReading(byteLength)` compared a
 * string with a number, so every PDF answered "not worth reading" and
 * `readPdfText` was never reached. The bytes are read as bytes and passed on.
 */
export async function fetchBody(url, { fetchImpl = fetch, robots = createRobotsChecker({ fetchImpl }) } = {}) {
  if (!isHarvestableOperatorUrl(url)) return { ok: false, body: "", reason: "refused" };
  const permitted = await robots(url);
  if (!permitted.allowed) return { ok: false, body: "", reason: permitted.reason };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "text/html,application/xhtml+xml,application/pdf", "user-agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    const landing = harvestRedirectLanding(url, response.url);
    if (landing.outcome === "refused") {
      await response.body?.cancel?.();
      return { ok: false, body: "", reason: "redirect-refused" };
    }
    if (landing.outcome === "redirected" && !(await robots(landing.url)).allowed) {
      await response.body?.cancel?.();
      return { ok: false, body: "", reason: "redirect-robots-refused" };
    }
    if (!response.ok) {
      await response.body?.cancel?.();
      return { ok: false, body: "", reason: `http-${response.status}` };
    }
    const type = response.headers.get("content-type") ?? "";
    if (/pdf/i.test(type) || landing.url.toLowerCase().includes(".pdf")) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!pdfIsWorthReading(bytes.byteLength)) return { ok: false, body: "", reason: "pdf-not-worth-reading" };
      const text = await readPdfText(bytes);
      return { ok: Boolean(text), body: text ?? "", sourceFormat: "text", landedUrl: landing.url };
    }
    const body = await response.text();
    return { ok: true, body, sourceFormat: "html", landedUrl: landing.url };
  } catch {
    return { ok: false, body: "", reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

function pricedRowsFromSource(source, sourceFormat) {
  const reading = readVenueDrinkPrices(source, sourceFormat);
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
  const robots = createRobotsChecker();
  for (const url of slice) {
    try {
    const fetched = await fetchBody(url, { robots });
    if (!fetched.ok) {
      console.log(`  skip ${fetched.reason ?? "unreadable"} ${url}`);
      continue;
    }
    cache.set(url, pricedRowsFromSource(fetched.body, fetched.sourceFormat));
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
