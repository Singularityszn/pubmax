#!/usr/bin/env node
/**
 * London soft drinks and still/sparkling water harvest for chain menus that print
 * names and prices on the web.
 *
 *   node scripts/harvest_soft_drinks_menus.mjs --chain youngs --limit 30
 *   node scripts/harvest_soft_drinks_menus.mjs --chain greene-king --dry-run
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  dedupeSiteHarvestLedgerRows,
  loadCuratedUkBaseOwners,
  parseSiteHarvestLedgerText,
} from "../lib/siteHarvestLedgerCore.ts";
import { inGreaterLondon } from "./fetch_uk_osm_venues.mjs";
import { RefreshProviderError } from "./lib/localRefreshProviders.mjs";
import {
  HarvestMenuTransportError,
  assertLocalPolicyEnforcedTransport,
  assertTransportCredentials,
  createMenuPageHarvester,
  parseMenuTransportArg,
} from "./lib/harvestMenuTransport.mjs";
import {
  buildVenueIndexes,
} from "./lib/venueMatch.mjs";
import {
  buildCuratedSoftDrinkTargets,
  selectCuratedSoftDrinkTargets,
} from "./lib/softDrinkTargets.mjs";
import {
  classifySoftDrinkSubtypeId,
  filterSoftDrinkHarvestRows,
  parseGkSoftDrinkLines,
  parseMbplcSoftDrinkLines,
  parsePropellerMenuSoftDrinks,
  softDrinkRowsFromMenuPdfLinks,
  softDrinkRowsFromPageText,
} from "./lib/softDrinksMenuHarvest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SITE_HARVEST = join(ROOT, "data/uk_prices/site_harvest.jsonl");
const REPORT_PATH = join(ROOT, "data/uk_prices/soft_drinks_harvest_report.json");
const DATASET_PATH = join(ROOT, "public/data/pint_prices_app_dataset.json");
const ENRICHMENT_PATH = join(ROOT, "public/data/venue_menu_enrichment.json");

const CHAIN_CONFIG = {
  nicholsons: {
    sourceId: "mitchells-butlers-menu-prices",
    parser: "mbplc",
    cacheDir: join(ROOT, ".firecrawl", "menus", "soft-drinks", "nicholsons"),
  },
  wetherspoon: {
    sourceId: "wetherspoon-menu-prices",
    parser: "uk-crawl",
    cacheDir: join(ROOT, ".firecrawl", "menus", "soft-drinks", "wetherspoon"),
  },
  "greene-king": {
    sourceId: "greene-king-menu-prices",
    parser: "gk",
    cacheDir: join(ROOT, ".firecrawl", "menus", "soft-drinks", "greeneking"),
  },
  youngs: {
    sourceId: "youngs-menu-prices",
    parser: "uk-crawl",
    cacheDir: join(ROOT, ".firecrawl", "menus", "soft-drinks", "youngs"),
  },
  "slug-and-lettuce": {
    sourceId: "stonegate-menu-prices",
    parser: "uk-crawl",
    cacheDir: join(ROOT, ".firecrawl", "menus", "soft-drinks", "slug-and-lettuce"),
  },
  brewdog: {
    sourceId: "brewdog-menu-prices",
    parser: "uk-crawl",
    cacheDir: join(ROOT, ".firecrawl", "menus", "soft-drinks", "brewdog"),
  },
};

function parseArgs(argv) {
  let chain = "nicholsons";
  let limit = 200;
  let dryRun = false;
  let urlsFile = null;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--chain" && argv[i + 1]) chain = argv[++i];
    else if (argv[i] === "--limit" && argv[i + 1]) limit = parseInt(argv[++i], 10);
    else if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--urls-file" && argv[i + 1]) urlsFile = argv[++i];
  }
  return { chain, limit, dryRun, urlsFile };
}

async function extractRows(chain, markdown, ctx) {
  if (CHAIN_CONFIG[chain]?.parser === "mbplc") {
    return filterSoftDrinkHarvestRows(parseMbplcSoftDrinkLines(markdown));
  }
  if (CHAIN_CONFIG[chain]?.parser === "gk") {
    return filterSoftDrinkHarvestRows(parseGkSoftDrinkLines(markdown));
  }
  if (chain === "wetherspoon" || chain === "slug-and-lettuce" || chain === "youngs") {
    const fromPdf = await softDrinkRowsFromMenuPdfLinks(markdown, ctx);
    if (fromPdf.length > 0) return fromPdf;
  }
  const propeller = parsePropellerMenuSoftDrinks(markdown);
  if (propeller.length > 0) return propeller;
  return softDrinkRowsFromPageText(markdown);
}

async function scrapeMenu(url, cachePath, harvester) {
  mkdirSync(dirname(cachePath), { recursive: true });
  const page = await harvester.fetchMenuPage(url);
  writeFileSync(cachePath, `${page.markdown.trim()}\n`);
  return page;
}

function urlWithoutQuery(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "(invalid url)";
  }
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
  let { chain, limit, dryRun, urlsFile } = parseArgs(process.argv);
  const transport = parseMenuTransportArg(process.argv, "playwright");
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg) {
    console.error(`Unknown chain ${chain}; choose: ${Object.keys(CHAIN_CONFIG).join(", ")}`);
    process.exit(1);
  }
  assertLocalPolicyEnforcedTransport(transport);
  assertTransportCredentials(transport);
  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  const indexes = buildVenueIndexes(dataset);
  const enrichment = existsSync(ENRICHMENT_PATH)
    ? JSON.parse(readFileSync(ENRICHMENT_PATH, "utf8"))
    : { venues: {} };
  const curatedTargets = buildCuratedSoftDrinkTargets({
    chain,
    enrichment,
    indexes,
    inGreaterLondon,
  });
  if (curatedTargets.length === 0) {
    throw new Error(`No unambiguous curated London venue bindings exist for ${chain}; refusing URL-only harvest.`);
  }
  let urlsFileText;
  if (urlsFile) {
    if (!existsSync(urlsFile)) throw new Error(`--urls-file does not exist: ${urlsFile}`);
    urlsFileText = readFileSync(urlsFile, "utf8");
  }
  const targets = selectCuratedSoftDrinkTargets(curatedTargets, { urlsFileText, limit });
  if (targets.length === 0) throw new Error("No curated menu targets selected; refusing an empty harvest run.");
  const associatedHosts = [...new Set(targets.map((target) => target.host))];
  const harvester = createMenuPageHarvester({
    transport,
    sourceId: cfg.sourceId,
    associatedHosts,
  });
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
    fetchFailures: [],
    refusals: [],
    pdfObservations: [],
    tavilyExtractsSpent: 0,
    startedAt: observedAt,
  };
  const landed = [];

  for (const target of targets) {
    const slug = target.url.replace(/[^a-z0-9]+/gi, "-").slice(0, 120);
    const cachePath = join(cfg.cacheDir, `${slug}.md`);
    let page;
    try {
      page = await scrapeMenu(target.url, cachePath, harvester);
      report.pagesRead += 1;
    } catch (error) {
      const failure = {
        url: target.url,
        code: error instanceof HarvestMenuTransportError ? error.code : "fetch-failed",
        message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
      };
      if (
        error instanceof HarvestMenuTransportError &&
        ["policy-refused", "robots-refused", "redirect-refused"].includes(error.code)
      ) {
        report.refused += 1;
        report.refusals.push(failure);
        continue;
      }
      report.fetchFailures.push(failure);
      if (
        error instanceof RefreshProviderError ||
        error instanceof HarvestMenuTransportError ||
        error instanceof Error
      ) {
        report.hosts.fetchFailed = (report.hosts.fetchFailed ?? 0) + 1;
        continue;
      }
      throw error;
    }
    const { markdown, finalUrl: sourceUrl } = page;
    const host = target.host;
    const pubName = target.pubName;
    const priced = await extractRows(chain, markdown, {
      pubName,
      pageUrl: sourceUrl,
      sourceId: cfg.sourceId,
      associatedHosts,
      waitForCrawlSpacing: harvester.waitForCrawlSpacing,
      markRequestCompleted: harvester.markRequestCompleted,
      onPdfEvent: (event) =>
        report.pdfObservations.push({
          url: urlWithoutQuery(event.url),
          status: event.status,
          ...(event.code ? { code: event.code } : {}),
        }),
    });
    const robotsDisallowed = harvester.lastRobotsDisallowed;
    for (const row of priced) {
      const ledgerRow = {
        host,
        venueId: target.venueId,
        name: pubName,
        category: row.category,
        priceGbp: row.priceGbp,
        drinkLabel: row.drinkLabel,
        sourceUrl,
        observedAt,
        pubsOnHost: 1,
        linesOnPage: priced.length,
        ...(robotsDisallowed ? { robotsDisallowed: true } : {}),
      };
      landed.push(ledgerRow);
      report.rowsLanded += 1;
      const subtype = classifySoftDrinkSubtypeId(row.drinkLabel);
      if (subtype) report.bySubtype[subtype] = (report.bySubtype[subtype] ?? 0) + 1;
      const brandKey = row.drinkLabel?.trim() ?? "";
      if (brandKey) report.byVerbatimLabel = report.byVerbatimLabel ?? {};
      if (brandKey) report.byVerbatimLabel[brandKey] = (report.byVerbatimLabel[brandKey] ?? 0) + 1;
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
        fetchFailures: report.fetchFailures.length,
        refusals: report.refusals.length,
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
