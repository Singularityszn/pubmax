#!/usr/bin/env node
// Usage, permission rules and resume behaviour:
// docs/UK_PRICE_HARVEST.md#lane-four-tavily-and-browserbase.
// `npm run build:uk-price-bundle` publishes the listed rows and
// `npm run harvest:uk-record-publications` records their evidence.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  loadCuratedUkBaseOwners,
  normalizeSiteHarvestLedgerRow,
  parseSiteHarvestLedgerText,
  siteHarvestLedgerCollectKey,
} from "../../../lib/siteHarvestLedgerCore.ts";
import { createRobotsChecker } from "../../../lib/harvest/robots.ts";
import { inGreaterLondon } from "../../fetch_uk_osm_venues.mjs";
import { classifyChainPub } from "../../lib/chainPubClassifier.mjs";
import {
  extractTavilyPages,
  fetchRefreshPage,
  fetchTinyfishPage,
  readTavilyRemainingCredits,
  searchTavilySites,
} from "../../lib/localRefreshProviders.mjs";
import { siteHarvestPriceKey } from "../../../lib/harvest/ukPriceCrawl.ts";
import { readPdfText } from "../../../lib/harvest/pdfText.ts";
import { harvestCityScope } from "./cityScope.mjs";
import { hostOfUrl } from "./exaSites.mjs";
import { fetchText } from "./run.mjs";
import { readVenueDrinkPricesForHarvest } from "./readPrices.mjs";
import {
  createCreditBudget,
  DISCOVERY_EXCLUDED_DOMAINS,
  harvestPubBatch,
  permittedTavilySite,
  siteLinksFromPage,
  tavilyOutcomeNeedsRetry,
  TAVILY_LANE_OUTCOMES,
} from "./tavilyLane.mjs";

const ROOT = process.cwd();
const OSM_PUBS = path.join(ROOT, "data/osm/uk/uk_osm_pubs.json");
const BUNDLE_ROWS = path.join(ROOT, "public/data/uk_prices/rows.json");
const OUT_DIR = path.join(ROOT, "data-harvest/uk_prices");
const LEDGER_PATH = path.join(OUT_DIR, "tavily_pubs.json");
const ROWS_PATH = path.join(OUT_DIR, "rows.jsonl");
const PUBLISHED_ROWS = path.join(ROOT, "data/uk_prices/site_harvest.jsonl");
const REPORT_PATH = path.join(ROOT, "data/uk_prices/tavily_report.json");

/** Credits left untouched on the plan, so a run never spends the account dry. */
const CREDIT_RESERVE = 50;
const DEFAULT_MAX_CREDITS = 100;
const DEFAULT_RENDERS = 25;
const DEFAULT_BATCH = 20;

const flag = (name) => process.argv.includes(name);
function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function ukBaseVenueId(osmId) {
  const match = /^(node|way|relation)\/(\d+)$/.exec(String(osmId ?? "").trim());
  return match ? `venue-uk-${match[1][0]}${match[2]}` : null;
}

function readJson(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}

/** Venue ids the bundle already holds a listed price for. */
function listedVenueIds() {
  const rows = readJson(BUNDLE_ROWS, []);
  return new Set(rows.filter((row) => row.standing === "listed").map((row) => row.venueId));
}

/** The snapshot's stated websites: how many pubs each host serves, and its one owner. */
function statedHosts(pubs) {
  const counts = new Map();
  const owner = new Map();
  for (const pub of pubs) {
    const host = pub.website ? hostOfUrl(pub.website.includes("//") ? pub.website : `https://${pub.website}`) : null;
    if (!host) continue;
    counts.set(host, (counts.get(host) ?? 0) + 1);
    owner.set(host, counts.get(host) === 1 ? pub.osmId : null);
  }
  return { counts, owner };
}

function siteUrlOf(pub) {
  if (!pub.website) return null;
  const raw = pub.website.includes("//") ? pub.website : `https://${pub.website}`;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.href;
  } catch {
    return null;
  }
}

function scopeFilter() {
  const cities = harvestCityScope((option("--city", "") || "").split(","));
  if (flag("--london") && cities) throw new Error("--london and --city cannot be combined");
  if (flag("--london")) return { name: "london", contains: inGreaterLondon };
  if (cities) return { name: cities.ids.join(","), contains: (pub) => cities.contains(pub) };
  return { name: "uk", contains: () => true };
}

/** Unpriced pubs first, then pubs that state a website, which cost no search. */
function orderTargets(pubs, listed) {
  return pubs.toSorted((a, b) => {
    const priced = Number(listed.has(ukBaseVenueId(a.osmId))) - Number(listed.has(ukBaseVenueId(b.osmId)));
    const site = Number(!a.website) - Number(!b.website);
    return priced || site || String(a.osmId).localeCompare(String(b.osmId));
  });
}

function ledgerRowsFor(pub, outcome, observedAt) {
  return outcome.rows.map((row) => ({
    host: outcome.host,
    venueId: outcome.venueId,
    osmId: pub.osmId,
    name: pub.name,
    postcode: pub.postcode ?? null,
    lat: pub.lat,
    lng: pub.lng,
    category: row.category,
    priceGbp: row.priceGbp,
    ...(row.drinkLabel ? { drinkLabel: row.drinkLabel } : {}),
    ...(row.servingSize ? { servingSize: row.servingSize } : {}),
    sourceUrl: row.url,
    observedAt,
    pubsOnHost: outcome.pubsOnHost,
    linesOnPage: row.linesOnPage,
    renderer: row.renderer,
  }));
}

export function persistTavilyRows(files, targets, outcomes, observedAt) {
  const harvested = outcomes.flatMap((outcome, index) => ledgerRowsFor(
    targets[index].pub, { ...outcome, pubsOnHost: targets[index].pubsOnHost }, observedAt,
  ));
  if (!harvested.length) return 0;
  const owners = loadCuratedUkBaseOwners();
  let written = 0;
  for (const file of files) {
    const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
    const observationKey = (row) => JSON.stringify([
      siteHarvestLedgerCollectKey(row, owners), row.priceGbp, row.observedAt,
    ]);
    const seen = new Set(parseSiteHarvestLedgerText(previous).map(observationKey));
    const fresh = harvested.filter((row) => {
      const key = observationKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fresh.length) continue;
    appendFileSync(file, `${previous && !previous.endsWith("\n") ? "\n" : ""}${fresh.map((row) => JSON.stringify(row)).join("\n")}\n`);
    written = Math.max(written, fresh.length);
  }
  return written;
}

function tally(entries, key) {
  const counts = {};
  for (const entry of entries) {
    const value = entry[key] ?? "unrecorded";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function writeReport({ ledger, scope, run }) {
  const entries = Object.values(ledger.pubs);
  const outcomes = Object.fromEntries(TAVILY_LANE_OUTCOMES.map((name) => [name, 0]));
  for (const [name, count] of Object.entries(tally(entries, "outcome"))) outcomes[name] = count;
  const refusedHosts = new Map();
  for (const entry of entries) {
    for (const refusal of entry.refusals ?? []) {
      const host = hostOfUrl(refusal.url);
      if (host && !refusedHosts.has(host)) refusedHosts.set(host, refusal.reason);
    }
  }
  const report = {
    version: 1,
    generatedAt: run.finishedAt,
    scope,
    pubsInLedger: entries.length,
    outcomes,
    robotsFiles: tally(entries.filter((entry) => entry.robots), "robots"),
    pubsPricedViaDiscovery: entries.filter((entry) => entry.rowCount > 0 && entry.discovered).length,
    thisRun: run,
    refusedHosts: [...refusedHosts].map(([host, reason]) => ({ host, reason })).sort((a, b) => a.host.localeCompare(b.host)),
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function readPriceKeysByVenue() {
  const priceKeysByVenue = new Map();
  for (const file of [ROWS_PATH, PUBLISHED_ROWS]) {
    if (!existsSync(file)) continue;
    for (const input of parseSiteHarvestLedgerText(readFileSync(file, "utf8"))) {
      const row = normalizeSiteHarvestLedgerRow(input);
      if (typeof row.priceGbp !== "number" || !row.venueId || !row.category) continue;
      if (!priceKeysByVenue.has(row.venueId)) priceKeysByVenue.set(row.venueId, new Set());
      priceKeysByVenue.get(row.venueId).add(siteHarvestPriceKey(row.category, row.drinkLabel ?? row.drinkName, row.servingSize));
    }
  }
  return priceKeysByVenue;
}

/** The pubs this run reads, in order, with each one's saved progress. Chain and refused pubs are recorded, not queued. */
export function buildQueue(ordered, { ledger, pubLimit, hostCounts }) {
  const queue = [];
  const priceKeysByVenue = readPriceKeysByVenue();
  let chainsDelegated = 0;
  for (const pub of ordered) {
    if (queue.length >= pubLimit) break;
    if (classifyChainPub(pub)) {
      ledger.pubs[pub.osmId] = { outcome: "chain-delegated", at: new Date().toISOString(), venueId: ukBaseVenueId(pub.osmId) };
      chainsDelegated += 1;
      continue;
    }
    const previous = ledger.pubs[pub.osmId];
    const progress = tavilyOutcomeNeedsRetry(previous?.outcome) ? previous : null;
    const statedSite = siteUrlOf(pub);
    const siteUrl = statedSite ?? (previous?.discovered ? previous.siteUrl ?? null : null);
    if (siteUrl && !permittedTavilySite(siteUrl)) {
      ledger.pubs[pub.osmId] = {
        outcome: "policy-refused-host",
        at: new Date().toISOString(),
        venueId: ukBaseVenueId(pub.osmId),
        refusals: [{ url: siteUrl, reason: "policy-refused-host" }],
      };
      continue;
    }
    queue.push({
      pub,
      venueId: ukBaseVenueId(pub.osmId),
      siteUrl,
      seedUrls: previous?.seedUrls ?? [],
      refusals: progress?.refusals ?? [],
      pendingUrls: progress?.pendingUrls ?? [],
      completedUrls: progress?.completedUrls ?? [],
      bindingUrl: progress?.bindingUrl ?? null,
      addressBound: progress?.addressBound === true,
      priceKeys: [...new Set([...(previous?.priceKeys ?? []), ...(priceKeysByVenue.get(ukBaseVenueId(pub.osmId)) ?? [])])],
      discovered: !statedSite && previous?.discovered === true,
      pubsOnHost: siteUrl ? hostCounts.get(hostOfUrl(siteUrl)) ?? 1 : 1,
    });
  }
  return { queue, chainsDelegated };
}

/** Browserbase when its key is set, else TinyFish's free fetch, else no renderer. */
function chooseRenderer(environment = process.env) {
  if (environment.BROWSERBASE_API_KEY?.trim()) {
    return { name: "browserbase", render: (url) => fetchRefreshPage({ job: "rendered-menu", url }) };
  }
  if (environment.TINYFISH_API_KEY?.trim()) return { name: "tinyfish", render: (url) => fetchTinyfishPage({ url }) };
  return { name: null, render: null };
}

function runSummary({ startedAt, runOutcomes, rowsWritten, reported, renderer, budget }) {
  const priced = runOutcomes.filter((outcome) => outcome.rows.length > 0);
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    pubsRead: runOutcomes.length,
    pubsPriced: priced.length,
    rowsWritten,
    categories: tally(priced.flatMap((outcome) => outcome.rows), "category"),
    outcomes: tally(runOutcomes, "outcome"),
    searches: runOutcomes.reduce((sum, outcome) => sum + outcome.searches, 0),
    pagesExtracted: reported.pagesRead,
    pagesRendered: runOutcomes.reduce((sum, outcome) => sum + outcome.rendered, 0),
    rendering: renderer.name ?? "not configured (BROWSERBASE_API_KEY and TINYFISH_API_KEY unset)",
    renderErrors: [...new Set(runOutcomes.flatMap((outcome) => outcome.renderErrors))].slice(0, 10),
    creditsSpent: Number(budget.spent.toFixed(2)),
    creditsPerPub: runOutcomes.length ? Number((budget.spent / runOutcomes.length).toFixed(3)) : 0,
    creditsPerPricedPub: priced.length ? Number((budget.spent / priced.length).toFixed(3)) : null,
    providerReportedCredits: { search: reported.search, extract: reported.extract },
  };
}

async function main() {
  const scope = scopeFilter();
  const pubLimit = Number(option("--pubs", "50"));
  const batchSize = Math.max(1, Math.min(Number(option("--batch", DEFAULT_BATCH)), 50));
  const recheck = option("--recheck", null);
  const snapshot = readJson(OSM_PUBS, { pubs: [] });
  const pubs = Array.isArray(snapshot) ? snapshot : snapshot.pubs;
  const { counts: hostCounts, owner: hostOwner } = statedHosts(pubs);
  const ledger = readJson(LEDGER_PATH, { version: 1, pubs: {}, claimedHosts: {} });
  const renderer = chooseRenderer();

  for (const [host, osmId] of Object.entries(ledger.claimedHosts)) {
    if (ledger.pubs[osmId]?.addressBound !== true || ledger.pubs[osmId]?.host !== host) delete ledger.claimedHosts[host];
  }

  const inScope = pubs.filter((pub) => scope.contains(pub));
  const due = inScope.filter((pub) => {
    const seen = ledger.pubs[pub.osmId];
    return !seen || (recheck && seen.outcome === recheck) || tavilyOutcomeNeedsRetry(seen.outcome);
  });
  const { queue, chainsDelegated } = buildQueue(orderTargets(due, listedVenueIds()), { ledger, pubLimit, hostCounts });

  const withSite = queue.filter((target) => target.siteUrl).length;
  console.log(
    `[tavily] scope ${scope.name}: ${inScope.length} pubs, ${due.length} due, ${queue.length} queued (${withSite} with a stated site, ${queue.length - withSite} to search), ${chainsDelegated} chain pubs left to the chain lanes`,
  );
  if (flag("--dry-run")) {
    console.log(`[tavily] dry run: about ${(queue.length - withSite) + queue.length * 0.8} credits at most; nothing fetched`);
    return;
  }

  const remaining = await readTavilyRemainingCredits();
  const askedCredits = Number(option("--max-credits", DEFAULT_MAX_CREDITS));
  const allowance = Math.max(0, Math.min(askedCredits, remaining === null ? askedCredits : remaining - CREDIT_RESERVE));
  const budget = createCreditBudget(allowance);
  console.log(`[tavily] plan remainder ${remaining ?? "unlimited"}, run allowance ${allowance} credits`);

  let rendersLeft = renderer.render ? Number(option("--renders", DEFAULT_RENDERS)) : 0;
  const reported = { search: 0, extract: 0, pagesRead: 0 };
  const checkRobots = createRobotsChecker();
  const robots = (url) => permittedTavilySite(url)
    ? checkRobots(url)
    : Promise.resolve({ allowed: false, reason: "policy-refused-host" });
  const deps = {
    robots,
    search: (query) => searchTavilySites({ query, excludeDomains: [...DISCOVERY_EXCLUDED_DOMAINS] }),
    siteSearch: (host, name) =>
      searchTavilySites({ query: `"${name}" drinks menu prices`, includeDomains: [host], maxResults: 5 }),
    readPdf: async (url) => {
      const page = await fetchText(url, { robots });
      if (!page.ok || !page.pdf) return { error: page.ok ? "not a PDF" : `HTTP ${page.status}`, refusal: page.reason };
      const text = page.bytes ? await readPdfText(page.bytes) : null;
      return text ? { text, finalUrl: page.finalUrl } : { error: "pdf has no text layer" };
    },
    siteLinks: async (url) => {
      const page = await fetchText(url, { robots });
      return siteLinksFromPage(page);
    },
    extract: (urls) => extractTavilyPages({ urls }),
    render: renderer.render,
    renderBudget: { take: () => (rendersLeft > 0 ? (rendersLeft -= 1, true) : false) },
    readPrices: (markdown, ctx) => readVenueDrinkPricesForHarvest(markdown, ctx, "text"),
    stateOwner: (host) => hostOwner.get(host) ?? (hostCounts.has(host) ? "estate" : null),
    claimedBy: (host) => ledger.claimedHosts[host] ?? null,
    claim: (host, osmId) => {
      ledger.claimedHosts[host] = osmId;
    },
    onCredits: ({ search, extract, pagesRead }) => {
      reported.search += search ?? 0;
      reported.extract += extract ?? 0;
      reported.pagesRead += pagesRead ?? 0;
    },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const runOutcomes = [];
  let rowsWritten = 0;
  for (let at = 0; at < queue.length; at += batchSize) {
    if (!budget.canSpend(0.2)) break;
    const batch = queue.slice(at, at + batchSize);
    const outcomes = await harvestPubBatch(batch, deps, budget);
    const observedAt = new Date().toISOString();
    outcomes.forEach((outcome, index) => {
      const target = batch[index];
      for (const [host, owner] of Object.entries(ledger.claimedHosts)) {
        if (owner === target.pub.osmId && (!outcome.addressBound || outcome.host !== host)) {
          delete ledger.claimedHosts[host];
        }
      }
      const { rows, drops, ...kept } = outcome;
      ledger.pubs[target.pub.osmId] = { ...kept, at: observedAt, rowCount: outcome.priceKeys.length, dropCount: drops.length };
      runOutcomes.push(outcome);
      console.log(`  ${outcome.outcome.padEnd(24)} ${target.pub.name} (${outcome.host ?? "no site"}) ${rows.length} row(s)`);
    });
    rowsWritten += persistTavilyRows([ROWS_PATH, PUBLISHED_ROWS], batch, outcomes, observedAt);
    writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
  }

  const run = runSummary({ startedAt, runOutcomes, rowsWritten, reported, renderer, budget });
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
  const report = writeReport({ ledger, scope: scope.name, run });
  console.log("\n[tavily]", JSON.stringify(report.thisRun, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
