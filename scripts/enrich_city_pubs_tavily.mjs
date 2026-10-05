#!/usr/bin/env node
/**
 * Discover official pub pages and provenance-stamped pint prices with Tavily.
 *
 * Usage:
 *   npm run enrich:city -- --city=manchester
 *   npm run enrich:city -- --city=manchester --max-queries=200 --reset
 *   npm run enrich:city -- --city=london --max-queries=200 --max-credits=400
 *
 * Two ceilings are held in code and neither can be raised from here: 200
 * queries and 400 credits per run (an advanced search is 2 credits, so a full
 * run is $3.20 at the $0.008 pay as you go price). --max-queries and
 * --max-credits can only lower them.
 *
 * TAVILY_API_KEY is required. Local progress lives in ignored .tavily/ state.
 * Wetherspoons, Greene King, and Mitchells & Butlers pubs are delegated to the
 * existing chain harvesters and consume no Tavily queries.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CITY_DEFINITIONS,
  MAX_TAVILY_CREDITS_PER_RUN,
  mergeCanonicalPrices,
  OFFICIAL_SITE_SOURCE_LICENCE,
  runCityEnrichment,
  selectCityPubs,
  venueKeyForOsmPub,
} from "./lib/tavilyPubEnrichment.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const UK_PACK_PATH = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const CHECKPOINT_DIR = path.join(ROOT, ".tavily", "enrichment");
const REPORT_ROOT = path.join(ROOT, "data", "enrichment", "tavily");
const PRICE_DIR = path.join(ROOT, "public", "data", "drink_price_updates");
const DEFAULT_MAX_QUERIES = 200;
const MAX_TAVILY_QUERIES_PER_RUN = 200;

function readArg(argv, name) {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseArgs(argv) {
  const city = String(readArg(argv, "--city") ?? "").trim().toLowerCase();
  const rawMax = readArg(argv, "--max-queries");
  const maxQueries = rawMax === undefined ? DEFAULT_MAX_QUERIES : Number(rawMax);
  if (!CITY_DEFINITIONS[city]) {
    throw new Error(`--city must be one of: ${Object.keys(CITY_DEFINITIONS).join(", ")}`);
  }
  if (!Number.isInteger(maxQueries) || maxQueries < 1 || maxQueries > MAX_TAVILY_QUERIES_PER_RUN) {
    throw new Error("--max-queries must be an integer from 1 to 200.");
  }
  const rawCredits = readArg(argv, "--max-credits");
  const maxCredits = rawCredits === undefined ? MAX_TAVILY_CREDITS_PER_RUN : Number(rawCredits);
  if (!Number.isInteger(maxCredits) || maxCredits < 1 || maxCredits > MAX_TAVILY_CREDITS_PER_RUN) {
    throw new Error(`--max-credits must be an integer from 1 to ${MAX_TAVILY_CREDITS_PER_RUN}.`);
  }
  return {
    city,
    maxQueries,
    maxCredits,
    reset: argv.includes("--reset"),
    dryRun: argv.includes("--dry-run"),
  };
}

function atomicWriteJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function checkpointPath(city) {
  return path.join(CHECKPOINT_DIR, `${city}.json`);
}

function loadCityPubs(cityId) {
  const pack = JSON.parse(readFileSync(UK_PACK_PATH, "utf8"));
  return selectCityPubs(cityId, Array.isArray(pack.pubs) ? pack.pubs : []);
}

// Version 2 replaced the one-way cursor with a read time per pub. A checkpoint
// from another version, city or pack is not resumable, so it restarts.
const CHECKPOINT_VERSION = 2;

function priceKey(row) {
  return `${row.venueKey}|${String(row.drinkName).toLowerCase()}|${row.category}`;
}

/**
 * The official-site prices this city already has on disk. A restarted
 * checkpoint starts from them, because the evidence write replaces every
 * managed price for the city with the checkpoint's own, and a checkpoint that
 * started empty would delete every reviewed price it had not re-read tonight.
 */
export function committedCityPrices(existing, cityVenueKeys) {
  return existing.filter(
    (row) =>
      cityVenueKeys.has(row?.venueKey) &&
      row?.source?.licence === OFFICIAL_SITE_SOURCE_LICENCE,
  );
}

/**
 * The saved checkpoint when it still describes this city's pack, or a fresh
 * one seeded with the committed prices. A changed pack restarts the walk
 * rather than failing every night until someone deletes the file.
 */
export function resumeCheckpoint(saved, { city, totalPubs, committedPrices, observedAt }) {
  if (
    saved?.version === CHECKPOINT_VERSION &&
    saved.city === city &&
    saved.totalPubs === totalPubs
  ) {
    return saved;
  }
  return {
    version: CHECKPOINT_VERSION,
    city,
    totalPubs,
    observedAt,
    readAt: {},
    totalQueriesSpent: 0,
    totalCreditsSpent: 0,
    prices: committedPrices,
    pages: [],
    delegatedChains: [],
  };
}

/**
 * Every pub, stalest evidence first. A pub never read comes before any pub
 * that was, in the city's own order, so the first walk is the old sweep. Once
 * every pub has been read the walk does not stop: the oldest reads come round
 * again. Pack order breaks ties so one night's batch stays together.
 */
export function stalestFirst(pubs, readAt) {
  return pubs
    .map((pub, index) => ({ index, at: readAt[pub.osmId] ?? "" }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.index - b.index)
    .map((entry) => entry.index);
}

function uniqueBy(rows, keyFor) {
  const byKey = new Map();
  for (const row of rows) byKey.set(keyFor(row), row);
  return [...byKey.values()];
}

// A failed search is not a read, so that pub stays stalest and goes first next
// time. A pub matched again replaces its old rows, so a drink the page no
// longer lists does not outlive the page.
function mergeState(base, progress, observedAt) {
  const readAt = { ...base.readAt };
  for (const outcome of progress.outcomes ?? []) {
    if (outcome.status !== "failed") readAt[outcome.osmId] = observedAt;
  }
  const rematched = new Set(progress.pages.map((page) => page.venueKey));
  return {
    ...base,
    readAt,
    totalQueriesSpent: base.totalQueriesSpent + progress.queriesSpent,
    totalCreditsSpent: base.totalCreditsSpent + progress.creditsSpent,
    prices: uniqueBy(
      [...base.prices.filter((row) => !rematched.has(row.venueKey)), ...progress.prices],
      priceKey,
    ),
    pages: uniqueBy(
      [...base.pages, ...progress.pages],
      (row) => `${row.osmId}|${row.officialUrl}`,
    ),
    delegatedChains: uniqueBy(
      [...base.delegatedChains, ...progress.delegatedChains].map((row) => ({
        osmId: row.osmId ?? row.pub?.osmId,
        pubName: row.pubName ?? row.pub?.name,
        chain: row.chain,
        harvester: row.harvester,
      })),
      (row) => `${row.osmId}|${row.chain}`,
    ),
  };
}

/**
 * One capped pass over a city, stalest pubs first. A run that searched
 * nothing while a pub was still waiting for a search throws, so a spent-out
 * cap or a broken order is a red job rather than a quiet green one.
 */
export async function runCityPass({ checkpoint, pubs, observedAt, onState, ...options }) {
  const runResult = await runCityEnrichment({
    ...options,
    pubs,
    indices: stalestFirst(pubs, checkpoint.readAt),
    observedAt,
    onProgress: (progress) => onState?.(mergeState(checkpoint, progress, observedAt)),
  });
  const state = mergeState(checkpoint, runResult, observedAt);
  if (runResult.queriesSpent === 0 && runResult.outcomes.length < pubs.length) {
    throw new Error(
      `${options.city}: no search ran while ${pubs.length - runResult.outcomes.length} pubs were still due.`,
    );
  }
  return { runResult, state };
}

function dateStamp(iso) {
  return iso.slice(0, 10).replace(/-/g, "");
}

export function pruneManagedCityPrices(existing, cityVenueKeys) {
  return existing.filter(
    (row) =>
      !cityVenueKeys.has(row?.venueKey) ||
      row?.source?.licence !== OFFICIAL_SITE_SOURCE_LICENCE,
  );
}

function readUpdates(filePath) {
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")).updates ?? [] : [];
}

function writeEvidence(city, state, runResult, cityVenueKeys) {
  const generatedAt = new Date().toISOString();
  const stamp = dateStamp(generatedAt);
  const report = {
    version: 1,
    city,
    generatedAt,
    totalPubs: state.totalPubs,
    stats: {
      pubsRead: Object.keys(state.readAt).length,
      pubsMatched: state.pages.length,
      pricesExtracted: state.prices.length,
      queriesSpentThisRun: runResult.queriesSpent,
      creditsSpentThisRun: runResult.creditsSpent,
      queriesSpentTotal: state.totalQueriesSpent,
      creditsSpentTotal: state.totalCreditsSpent,
      chainPubsDelegated: state.delegatedChains.length,
    },
    pages: state.pages,
    delegatedChains: state.delegatedChains,
  };
  atomicWriteJson(path.join(REPORT_ROOT, city, `run_${stamp}.json`), report);

  if (state.prices.length === 0) return;
  const datedPath = path.join(PRICE_DIR, `prices_${stamp}.json`);
  atomicWriteJson(datedPath, {
    version: 1,
    generatedAt,
    updates: mergeCanonicalPrices(
      pruneManagedCityPrices(readUpdates(datedPath), cityVenueKeys),
      state.prices,
    ),
  });

  const latestPath = path.join(PRICE_DIR, "latest.json");
  atomicWriteJson(latestPath, {
    version: 1,
    generatedAt,
    updates: mergeCanonicalPrices(
      pruneManagedCityPrices(readUpdates(latestPath), cityVenueKeys),
      state.prices,
    ),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set.");

  const pubs = loadCityPubs(args.city);
  const cityVenueKeys = new Set(pubs.map(venueKeyForOsmPub));
  const statePath = checkpointPath(args.city);
  if (args.reset && existsSync(statePath)) rmSync(statePath);
  const observedAt = new Date().toISOString();
  const checkpoint = resumeCheckpoint(
    existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null,
    {
      city: args.city,
      totalPubs: pubs.length,
      committedPrices: committedCityPrices(
        readUpdates(path.join(PRICE_DIR, "latest.json")),
        cityVenueKeys,
      ),
      observedAt,
    },
  );

  console.log(
    `${args.city}: ${pubs.length} OSM pubs; ${Object.keys(checkpoint.readAt).length} read before; ` +
      `hard Tavily cap ${args.maxQueries} queries and ${args.maxCredits} credits.`,
  );

  const { runResult, state } = await runCityPass({
    city: args.city,
    checkpoint,
    pubs,
    apiKey,
    maxQueries: args.maxQueries,
    maxCredits: args.maxCredits,
    observedAt,
    onState: (next) => {
      if (!args.dryRun) atomicWriteJson(statePath, next);
    },
  });

  if (!args.dryRun) {
    atomicWriteJson(statePath, state);
    writeEvidence(args.city, state, runResult, cityVenueKeys);
  }

  console.log(
    `${args.city}: pubs matched ${runResult.matchedPubs}; prices extracted ${runResult.prices.length}; ` +
      `queries spent ${runResult.queriesSpent}/${args.maxQueries}; Tavily credits ${runResult.creditsSpent}; ` +
      `pubs read ${Object.keys(state.readAt).length}/${pubs.length}${args.dryRun ? " (dry run)" : ""}.`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
