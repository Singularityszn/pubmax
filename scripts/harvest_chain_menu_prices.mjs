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
//    lib/harvest/sourceRegistry.ts, kind `chain-menu-prices`, allowed rows only.
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
import { fileURLToPath } from "node:url";

import { fetchFollowingPermittedRedirects } from "../lib/harvest/redirectChain.ts";
import { createRobotsChecker } from "../lib/harvest/robots.ts";
import {
  harvestRedirectLanding,
  harvestSourcesOfKind,
  isHarvestableChainMenuUrl,
  isHarvestSourceAllowed,
} from "../lib/harvest/sourcePolicy.ts";
import {
  cheapestStatedPintRow,
  coverageLine,
  readChainPintPrices,
} from "../lib/harvest/chainMenuPrices.ts";
import { CITY_VENUE_PACKS } from "../lib/cityVenuePacks.mjs";

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

/**
 * Read one page of a chain source.
 *
 * Redirects are followed BY HAND, and each hop is asked before it is requested:
 * `harvestRedirectLanding` refuses a hop onto a refused estate or our own
 * network, the chain's own allow-list refuses a hop onto any host this source
 * row does not cover, and robots must permit the hop's path. A refused hop is
 * never sent. The final response is asked the same landing questions again, as
 * a second fence, and either way a refused body is never read.
 */
export async function fetchText(url, { sourceId, robots, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  const leftSource = (to) =>
    harvestRedirectLanding(url, to).outcome === "refused" || !isHarvestableChainMenuUrl(to, sourceId);
  try {
    const followed = await fetchFollowingPermittedRedirects(
      url,
      {
        headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
        signal: controller.signal,
      },
      {
        fetchImpl,
        permitHop: async (next) => {
          if (leftSource(next)) return { allowed: false, reason: "redirect-left-source" };
          const decision = await robots(next);
          return decision.allowed ? decision : { ...decision, reason: "redirect-robots-refused" };
        },
      },
    );
    if (followed.refusal) {
      const { status, reason, url: refusedUrl } = followed.refusal;
      return { ok: false, status, body: "", reason, landedUrl: refusedUrl };
    }
    const { response } = followed;
    const landing = harvestRedirectLanding(followed.url, response.url);
    if (leftSource(landing.url)) {
      await response.body?.cancel?.();
      return { ok: false, status: response.status, body: "", reason: "redirect-left-source", landedUrl: landing.url };
    }
    if (!response.ok) return { ok: false, status: response.status, body: "", landedUrl: landing.url };
    return { ok: true, status: response.status, body: await response.text(), landedUrl: landing.url };
  } catch (error) {
    return { ok: false, status: 0, body: "", error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Menu page URLs a source publishes about itself, from its own sitemap.
 *
 * A sitemap is the HOST's string, not ours, so every `<loc>` it names is put
 * back through the chain allow-list before it can become a fetch: a sitemap
 * that lists another host's page does not lend that page this source's
 * permission. The sitemap itself is a page too, so robots is asked about it
 * before it is read.
 */
export async function menuPagesFor(source, spend, { robots, fetchImpl = fetch } = {}) {
  if (!isHarvestableChainMenuUrl(source.url, source.id)) {
    return { pages: [], offAllowList: 1, refusal: null };
  }
  if (!source.url.endsWith(".xml")) return { pages: [source.url], offAllowList: 0, refusal: null };
  const decision = await robots(source.url);
  if (!decision.allowed) return { pages: [], offAllowList: 0, refusal: decision };
  if (!spend()) return { pages: [], offAllowList: 0, refusal: null };
  const sitemap = await fetchText(source.url, { sourceId: source.id, robots, fetchImpl });
  if (!sitemap.ok) return { pages: [], offAllowList: 0, refusal: null, reason: sitemap.reason };
  const named = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  const pages = named.filter((url) => isHarvestableChainMenuUrl(url, source.id));
  return { pages, offAllowList: named.length - pages.length, refusal: null };
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

/**
 * One run over the chain sources, with its network and clock edges injectable
 * so a test can prove what is and is not fetched without touching a host.
 */
export async function harvestChainMenuPrices({
  sources = harvestSourcesOfKind("chain-menu-prices"),
  fetchImpl = fetch,
  robots = createRobotsChecker({ fetchImpl }),
  sleepImpl = sleep,
  pageBudget = PAGE_BUDGET,
} = {}) {
  const allowed = sources.filter(isHarvestSourceAllowed);
  const refused = sources.filter((source) => !isHarvestSourceAllowed(source));

  const coverage = new Map();
  const drops = [];
  const rows = [];
  const skipped = [];

  let spent = 0;
  const spend = () => (spent < pageBudget ? (spent += 1, true) : false);

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
    const listed = await menuPagesFor(source, spend, { robots, fetchImpl });
    if (listed.reason) drops.push(listed.reason);
    if (listed.refusal) {
      skipped.push({ id: source.id, reason: listed.refusal.reason, checkedOn: new Date().toISOString().slice(0, 10), evidence: listed.refusal.evidence });
      continue;
    }
    // A sitemap entry outside this chain's own hosts is dropped and counted,
    // never fetched.
    for (let n = 0; n < listed.offAllowList; n += 1) drops.push("off-source-allow-list");
    for (const url of listed.pages) {
      if (!spend()) {
        skipped.push({ id: source.id, reason: "budget-exhausted", checkedOn: source.access.checkedOn, evidence: `page budget of ${pageBudget} spent` });
        break;
      }
      // Permission is re-asked live, per host, every run.
      const decision = await robots(url);
      if (!decision.allowed) {
        skipped.push({ id: source.id, reason: decision.reason, checkedOn: new Date().toISOString().slice(0, 10), evidence: decision.evidence });
        break;
      }
      await sleepImpl(delayMs);
      const page = await fetchText(url, { sourceId: source.id, robots, fetchImpl });
      if (page.reason) {
        drops.push(page.reason);
        continue;
      }
      if (page.ok && page.landedUrl !== url && !(await robots(page.landedUrl)).allowed) {
        drops.push("redirect-robots-refused");
        continue;
      }
      const city = cityOfUrl(url);
      const row = coverage.get(city) ?? { city, pagesRead: 0, venuesPriced: 0, pagesWithNoPrice: 0 };
      if (!page.ok) {
        row.pagesRead += 1;
        row.pagesWithNoPrice += 1;
        coverage.set(city, row);
        continue;
      }
      const reading = await readChainPintPricesMaybeJudged(page.body, {
        pubName: source.label,
        pageUrl: page.landedUrl,
      });
      drops.push(...reading.drops);
      row.pagesRead += 1;
      const cheapest = cheapestStatedPintRow(reading);
      if (cheapest === null) row.pagesWithNoPrice += 1;
      else {
        row.venuesPriced += 1;
        rows.push({
          url: page.landedUrl,
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
    pageBudget,
    sourcesAllowed: allowed.map((source) => source.id),
    sourcesSkipped: skipped,
    coverage: [...coverage.values()],
    drops: drops.reduce((counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }), {}),
    rowsFound: rows.length,
  };
  return { report, rows, skipped, allowed, spent };
}

async function main() {
  const { report, rows, skipped, allowed, spent } = await harvestChainMenuPrices();

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
