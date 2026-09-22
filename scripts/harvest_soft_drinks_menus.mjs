#!/usr/bin/env node
/**
 * London soft drinks and still/sparkling water harvest for chain menus that print
 * names and prices on the web.
 *
 *   node scripts/harvest_soft_drinks_menus.mjs --chain nicholsons --transport tavily
 *   node scripts/harvest_soft_drinks_menus.mjs --chain wetherspoon --limit 30 --transport browserbase
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { hostHasLondonDrinkCaptainOverride } from "../lib/harvest/sourcePolicy.ts";
import {
  dedupeSiteHarvestLedgerRows,
  loadCuratedUkBaseOwners,
  parseSiteHarvestLedgerText,
} from "../lib/siteHarvestLedger.ts";
import { inGreaterLondon } from "./fetch_uk_osm_venues.mjs";
import {
  HarvestMenuTransportError,
  assertTransportCredentials,
  createMenuPageHarvester,
  parseMenuTransportArg,
} from "./lib/harvestMenuTransport.mjs";
import { buildVenueIndexes, resolveVenueKeyFromPubName } from "./lib/venueMatch.mjs";
import {
  filterSoftDrinkHarvestRows,
  parseMbplcSoftDrinkLines,
  softDrinkRowsFromPageText,
} from "./lib/softDrinksMenuHarvest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SITE_HARVEST = join(ROOT, "data/uk_prices/site_harvest.jsonl");
const REPORT_PATH = join(ROOT, "data/uk_prices/soft_drinks_harvest_report.json");
const DATASET_PATH = join(ROOT, "public/data/pint_prices_app_dataset.json");
const WETHERSPOONS_PATH = join(ROOT, "public/data/wetherspoons/pubs.json");
const NICHOLSONS_URLS = join(ROOT, "data/nicholsons_london_drink_urls.txt");

const USER_AGENT =
  "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";

const CHAIN_CONFIG = {
  nicholsons: {
    sourceId: "mitchells-butlers-menu-prices",
    urlsFile: NICHOLSONS_URLS,
    parser: "mbplc",
    cacheDir: join(ROOT, ".firecrawl", "menus", "soft-drinks", "nicholsons"),
  },
  wetherspoon: {
    sourceId: "wetherspoon-menu-prices",
    parser: "uk-crawl",
    cacheDir: join(ROOT, ".firecrawl", "menus", "soft-drinks", "wetherspoon"),
  },
};

function parseArgs(argv) {
  let chain = "nicholsons";
  let limit = 200;
  let dryRun = false;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--chain" && argv[i + 1]) chain = argv[++i];
    else if (argv[i] === "--limit" && argv[i + 1]) limit = parseInt(argv[++i], 10);
    else if (argv[i] === "--dry-run") dryRun = true;
  }
  return { chain, limit, dryRun };
}

function loadUrls(chain, limit) {
  if (chain === "wetherspoon") {
    const raw = JSON.parse(readFileSync(WETHERSPOONS_PATH, "utf8"));
    const pubs = (raw.pubs ?? []).filter(
      (pub) =>
        typeof pub.latitude === "number" &&
        typeof pub.longitude === "number" &&
        inGreaterLondon({ lat: pub.latitude, lng: pub.longitude }),
    );
    return pubs
      .slice(0, limit)
      .map((pub) => ({ url: pub.menuUrl, pubName: pub.name, locality: pub.townCity }));
  }
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg?.urlsFile || !existsSync(cfg.urlsFile)) return [];
  return readFileSync(cfg.urlsFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http"))
    .slice(0, limit)
    .map((url) => ({ url, pubName: null, locality: null }));
}

function pubNameFromMbplcMarkdown(markdown) {
  const match = markdown.match(/^##\s+(.+)$/m);
  return match ? match[1].trim() : "Unknown pub";
}

async function extractRows(chain, markdown, ctx) {
  if (CHAIN_CONFIG[chain]?.parser === "mbplc") {
    return filterSoftDrinkHarvestRows(parseMbplcSoftDrinkLines(markdown));
  }
  const { readVenueDrinkPricesForHarvest } = await import("./harvest/uk-prices/readPrices.mjs");
  await readVenueDrinkPricesForHarvest(markdown, ctx);
  return softDrinkRowsFromPageText(markdown);
}

function venueKeyFor(chain, url, markdown, indexes) {
  if (chain === "wetherspoon") {
    const slug = url.replace(/\/$/, "").split("/").pop();
    const pub = slug?.replace(/-/g, " ");
    return resolveVenueKeyFromPubName(pub ?? "", indexes);
  }
  const pubName = pubNameFromMbplcMarkdown(markdown);
  return resolveVenueKeyFromPubName(pubName, indexes);
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function scrapeMenu(url, cachePath, harvester) {
  if (existsSync(cachePath)) return readFileSync(cachePath, "utf8");
  mkdirSync(dirname(cachePath), { recursive: true });
  const markdown = await harvester.fetchMenuMarkdown(url);
  writeFileSync(cachePath, `${markdown.trim()}\n`);
  return markdown;
}

function mergeIntoSiteHarvest(newRows) {
  const owners = loadCuratedUkBaseOwners(ROOT);
  const existing = existsSync(SITE_HARVEST)
    ? parseSiteHarvestLedgerText(readFileSync(SITE_HARVEST, "utf8"))
    : [];
  const merged = dedupeSiteHarvestLedgerRows([...existing, ...newRows], owners);
  writeFileSync(SITE_HARVEST, `${merged.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function main() {
  const { chain, limit, dryRun } = parseArgs(process.argv);
  const transport = parseMenuTransportArg();
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) {
    console.error(`Unknown chain ${chain}; choose: ${Object.keys(CHAIN_CONFIG).join(", ")}`);
    process.exit(1);
  }
  assertTransportCredentials(transport);
  const harvester = createMenuPageHarvester({ transport, sourceId: cfg.sourceId });
  const targets = loadUrls(chain, limit);
  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  const indexes = buildVenueIndexes(dataset);
  const observedAt = new Date().toISOString();
  const report = {
    chain,
    transport,
    pagesRequested: targets.length,
    pagesRead: 0,
    refused: 0,
    unmatched: 0,
    rowsLanded: 0,
    bySubtype: {},
    hosts: {},
    tavilyExtractsSpent: 0,
    startedAt: observedAt,
  };
  const landed = [];

  for (const target of targets) {
    const slug = target.url.replace(/[^a-z0-9]+/gi, "-").slice(0, 120);
    const cachePath = join(cfg.cacheDir, `${slug}.md`);
    let markdown;
    try {
      markdown = await scrapeMenu(target.url, cachePath, harvester);
      report.pagesRead += 1;
    } catch (error) {
      if (error instanceof HarvestMenuTransportError && error.code === "policy-refused") {
        report.refused += 1;
        continue;
      }
      throw error;
    }
    const host = hostFromUrl(target.url);
    const venueKey = venueKeyFor(chain, target.url, markdown, indexes);
    if (!venueKey) {
      report.unmatched += 1;
      continue;
    }
    const pubName = target.pubName ?? pubNameFromMbplcMarkdown(markdown);
    const priced = await extractRows(chain, markdown, { pubName, pageUrl: target.url });
    const robotsDisallowed = host && hostHasLondonDrinkCaptainOverride(host);
    for (const row of priced) {
      const ledgerRow = {
        host,
        venueId: venueKey,
        name: pubName,
        category: row.category,
        priceGbp: row.priceGbp,
        drinkLabel: row.drinkLabel,
        sourceUrl: target.url,
        observedAt,
        pubsOnHost: 1,
        linesOnPage: priced.length,
        ...(robotsDisallowed ? { robotsDisallowed: true } : {}),
      };
      landed.push(ledgerRow);
      report.rowsLanded += 1;
    }
    if (host) report.hosts[host] = (report.hosts[host] ?? 0) + 1;
  }

  report.tavilyExtractsSpent = harvester.extractsSpent;
  report.finishedAt = new Date().toISOString();
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (!dryRun && landed.length > 0) {
    mergeIntoSiteHarvest(landed);
  }

  console.log(
    JSON.stringify(
      {
        chain,
        transport,
        pagesRead: report.pagesRead,
        rowsLanded: report.rowsLanded,
        refused: report.refused,
        unmatched: report.unmatched,
        tavilyExtractsSpent: report.tavilyExtractsSpent,
        dryRun,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
