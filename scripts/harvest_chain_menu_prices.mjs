#!/usr/bin/env node
// Read the chain menu pages we are PERMITTED to read, take the pint prices they
// STATE, and report coverage per city.
//
//   npm run harvest:chain-prices              # every permitted chain
//   npm run harvest:chain-prices -- --dry-run # read and report, write nothing
//   npm run harvest:chain-prices -- --limit 20
//
// THREE RULES, and they are the whole design.
//
// 1. THE SOURCE TABLE DECIDES, NOT THE CALLER. Pages come from
//    lib/harvest/sourcePolicy.ts, kind `chain-menu-prices`, allowed rows only.
//    There is no --url flag: a source absent from that table is not read at all.
//
// 2. PERMISSION IS RE-ASKED LIVE. The table records a verdict and the day it was
//    checked; a host can change its mind between runs, so robots.txt is fetched
//    again here through lib/harvest/robots.ts, once per host, and an unreadable
//    robots.txt is a REFUSAL rather than a shrug.
//
// 3. A PRICE MUST BE ON THE PAGE. Every figure is verbatim-checked against the
//    page text and needs a drink word beside it, in the shared reader
//    lib/harvest/ukPriceCrawl.ts, mapped through lib/harvest/chainMenuPrices.ts.
//    Nothing is inferred, and every drop is counted and printed.
//
// WHAT THIS RETURNS TODAY IS NOTHING, and that is the finding rather than a
// fault. On 2026-09-03 all three chain menu sources are refused: Greene King and
// Wetherspoon both PERMIT the read and publish no price in the document, and
// Mitchells & Butlers still answers robots.txt with a Cloudflare challenge. The
// lane exists so that the day one of them publishes a price, taking it is a
// command rather than a project.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { discardBody } from "../lib/responseBody.ts";
import { createRobotsChecker } from "../lib/harvest/robots.ts";
import {
  harvestSourcesOfKind,
  isHarvestableChainMenuUrl,
  isHarvestSourceAllowed,
} from "../lib/harvest/sourcePolicy.ts";
import {
  cheapestStatedPint,
  cheapestStatedPintRow,
  coverageLine,
  readChainPintPrices,
} from "../lib/harvest/chainMenuPrices.ts";
import { CITY_VENUE_PACKS } from "../lib/cityVenuePacks.mjs";
import { fetchSourceBoundPage, permittedSitemapUrls } from "./lib/harvestCallerTransport.mjs";

const ROOT = process.cwd();
const DRINK_UPDATES = path.join(ROOT, "public/data/drink_price_updates/latest.json");
const REPORT_PATH = path.join(ROOT, "data/osm/chain_menu_price_harvest_log.json");

const USER_AGENT =
  "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";
const PAGE_TIMEOUT_MS = 30_000;
/** A run may never become a crawl. One number, and it counts retries. */
const DEFAULT_PAGE_BUDGET = 200;

const flag = (name) => process.argv.includes(name);
function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const DRY_RUN = flag("--dry-run");
const PAGE_BUDGET = Number(option("--limit", DEFAULT_PAGE_BUDGET));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Keyless shared reader, or the judged batch path when TYPESAFE_API_KEY is set.
 * The model call lives in readPrices.mjs so this CLI stays free of it until a
 * key is actually present.
 */
async function readChainPintPricesMaybeJudged(html, ctx) {
  if (!process.env.TYPESAFE_API_KEY?.trim()) return readChainPintPrices(html);
  const { readChainPintPricesForHarvest } = await import("./harvest/uk-prices/readPrices.mjs");
  const { reading } = await readChainPintPricesForHarvest(html, ctx);
  return reading;
}

async function fetchText(url, robots, sourcePredicate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  let response = null;
  try {
    const result = await fetchSourceBoundPage(url, robots, {
      sourcePredicate,
      init: {
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
        signal: controller.signal,
      },
    });
    if (!result.ok) {
      if (result.response) discardBody(result.response);
      return {
        ok: false,
        status: result.response?.status ?? 0,
        body: "",
        finalUrl: result.url,
        error: result.reason,
      };
    }
    response = result.response;
    if (!response.ok) {
      discardBody(response);
      return { ok: false, status: response.status, body: "", finalUrl: result.url };
    }
    return { ok: true, status: response.status, body: await response.text(), finalUrl: result.url };
  } catch (error) {
    if (response) discardBody(response);
    return { ok: false, status: 0, body: "", finalUrl: url, error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Menu page URLs a source publishes about itself, from its own sitemap. */
function sourceUrlPredicate(source) {
  return (value) => isHarvestableChainMenuUrl(value, source.id, source.renderedMenuHosts ?? []);
}

async function menuPagesFor(source, spend, robots) {
  if (!source.url.endsWith(".xml")) return { pages: [source.url] };
  if (!spend()) {
    return {
      pages: [],
      refusal: {
        id: source.id,
        reason: "budget-exhausted",
        checkedOn: source.access.checkedOn,
        evidence: "page budget spent before sitemap read",
      },
    };
  }
  const sitemap = await fetchText(source.url, robots, sourceUrlPredicate(source));
  if (!sitemap.ok) {
    return {
      pages: [],
      refusal: {
        id: source.id,
        reason: "sitemap-fetch-failed",
        checkedOn: new Date().toISOString().slice(0, 10),
        evidence: sitemap.error ?? `HTTP ${sitemap.status}`,
      },
    };
  }
  const pages = permittedSitemapUrls(sitemap.body, sourceUrlPredicate(source));
  if (pages.length === 0) {
    return {
      pages,
      refusal: {
        id: source.id,
        reason: "sitemap-no-permitted-pages",
        checkedOn: new Date().toISOString().slice(0, 10),
        evidence: `sitemap landed at ${sitemap.finalUrl} but carried no permitted publisher URLs`,
      },
    };
  }
  return { pages };
}

function cityOfUrl(url) {
  // A chain page names its own town in its slug more often than not. Where it
  // does not, the row is counted under `unplaced` rather than guessed into a
  // city it may not be in.
  const slug = url.toLowerCase();
  for (const city of Object.keys(CITY_VENUE_PACKS)) {
    if (slug.includes(`/${city}`) || slug.includes(`-${city}`) || slug.includes(`${city}-`)) return city;
  }
  return "unplaced";
}

async function main() {
  const sources = harvestSourcesOfKind("chain-menu-prices");
  const allowed = sources.filter(isHarvestSourceAllowed);
  const refused = sources.filter((source) => !isHarvestSourceAllowed(source));

  const robots = createRobotsChecker();
  const coverage = new Map();
  const drops = [];
  const rows = [];
  const skipped = [];

  let spent = 0;
  const spend = () => (spent < PAGE_BUDGET ? (spent += 1, true) : false);

  // A SKIP IS A FINDING. Every refused source prints its own reason and the day
  // that reason was checked, so "we harvested nothing from Wetherspoon" reads as
  // a recorded decision rather than as coverage nobody noticed was missing.
  for (const source of refused) {
    skipped.push({
      id: source.id,
      reason: source.access.reason,
      checkedOn: source.access.checkedOn,
      evidence: source.access.evidence,
    });
  }

  for (const source of allowed) {
    const delayMs = (source.crawlDelaySeconds ?? 1) * 1000;
    const plan = await menuPagesFor(source, spend, robots);
    if (plan.refusal) skipped.push(plan.refusal);
    const pages = plan.pages;
    for (const url of pages) {
      if (!spend()) {
        skipped.push({ id: source.id, reason: "budget-exhausted", checkedOn: source.access.checkedOn, evidence: `page budget of ${PAGE_BUDGET} spent` });
        break;
      }
      // Permission is re-asked live, per host, every run.
      const decision = await robots(url);
      if (!decision.allowed) {
        skipped.push({ id: source.id, reason: decision.reason, checkedOn: new Date().toISOString().slice(0, 10), evidence: decision.evidence });
        break;
      }
      await sleep(delayMs);
      const page = await fetchText(url, robots, sourceUrlPredicate(source));
      const pageUrl = page.finalUrl ?? url;
      if (!isHarvestableChainMenuUrl(pageUrl, source.id, source.renderedMenuHosts ?? [])) {
        skipped.push({
          id: source.id,
          reason: "redirect-outside-publisher",
          checkedOn: new Date().toISOString().slice(0, 10),
          evidence: `${url} landed at ${pageUrl}, outside the recorded publisher hosts`,
        });
        continue;
      }
      const city = cityOfUrl(pageUrl);
      const row = coverage.get(city) ?? { city, pagesRead: 0, venuesPriced: 0, pagesWithNoPrice: 0 };
      if (!page.ok) {
        row.pagesRead += 1;
        row.pagesWithNoPrice += 1;
        coverage.set(city, row);
        continue;
      }
      const reading = await readChainPintPricesMaybeJudged(page.body, {
        pubName: source.label,
        pageUrl,
      });
      drops.push(...reading.drops);
      row.pagesRead += 1;
      const cheapest = cheapestStatedPintRow(reading);
      if (cheapest === null) row.pagesWithNoPrice += 1;
      else {
        row.venuesPriced += 1;
        rows.push({
          url: pageUrl,
          priceGbp: cheapest.priceGbp,
          ...(cheapest.drinkLabel ? { drinkLabel: cheapest.drinkLabel } : {}),
          sourceId: source.id,
          label: source.label,
          observedAt: new Date().toISOString(),
        });
      }
      coverage.set(city, row);
    }
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    pagesRead: spent,
    pageBudget: PAGE_BUDGET,
    sourcesAllowed: allowed.map((source) => source.id),
    sourcesSkipped: skipped,
    coverage: [...coverage.values()],
    drops: drops.reduce((counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }), {}),
    rowsFound: rows.length,
  };

  if (!DRY_RUN) {
    mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(`chain menu price harvest: ${rows.length} row(s) from ${spent} page(s)`);
  console.log(`  permitted sources: ${allowed.length ? allowed.map((s) => s.id).join(", ") : "(none)"}`);
  for (const skip of skipped) console.log(`  SKIP ${skip.id}: ${skip.reason} (checked ${skip.checkedOn})`);
  for (const row of report.coverage) console.log(`  ${coverageLine(row)}`);
  if (Object.keys(report.drops).length) console.log(`  drops: ${JSON.stringify(report.drops)}`);
  if (!DRY_RUN) console.log(`  report → ${path.relative(ROOT, REPORT_PATH)}`);

  // Rows are NOT merged into the drink price store here. A price that reaches a
  // reader crosses the same reviewed publish every other price does, and a
  // harvest that could write straight through would be one bad selector away
  // from putting an invented figure on a pub. The rows are reported; publishing
  // them is a separate, deliberate step.
  if (rows.length > 0 && existsSync(DRINK_UPDATES)) {
    console.log(`  ${rows.length} row(s) await a reviewed publish into ${path.relative(ROOT, DRINK_UPDATES)}`);
  }
}

await main();
