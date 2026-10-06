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
 * --reset restarts the walk and keeps the prices found so far. Rows listed in
 * data/enrichment/tavily/<city>/rejected.json are never written again, and a
 * price listed in corrected.json beside it is never overwritten by a reading.
 * Wetherspoons, Greene King, and Mitchells & Butlers pubs are delegated to the
 * existing chain harvesters and consume no Tavily queries.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
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

export function loadCityPubs(cityId) {
  const pack = JSON.parse(readFileSync(UK_PACK_PATH, "utf8"));
  return selectCityPubs(cityId, Array.isArray(pack.pubs) ? pack.pubs : []);
}

// Version 2 replaced the one-way cursor with a read time per pub. A checkpoint
// from another version, city or pack is not resumable, so its walk restarts.
const CHECKPOINT_VERSION = 2;

function priceKey(row) {
  return `${row.venueKey}|${String(row.drinkName).toLowerCase()}|${row.category}`;
}

/** One reading of one price: the same drink read on another night is another row. */
function readingId(row) {
  return `${priceKey(row)}|${row.observedAt}`;
}

/** The official-site prices this city holds in the committed data. */
export function committedCityPrices(existing, cityVenueKeys) {
  return existing.filter(
    (row) =>
      cityVenueKeys.has(row?.venueKey) &&
      row?.source?.licence === OFFICIAL_SITE_SOURCE_LICENCE,
  );
}

/**
 * The rows a reviewer rejected, from the committed `rejected.json` beside the
 * run reports. Each entry is a venue key and a source URL, and no row matching
 * one is ever written again.
 */
export function readRejectedRows(value) {
  if (value === undefined) return [];
  if (value?.version !== 1 || !Array.isArray(value.rows)) {
    throw new Error("rejected.json must be { version: 1, rows: [...] }.");
  }
  for (const row of value.rows) {
    if (typeof row?.venueKey !== "string" || typeof row?.sourceUrl !== "string") {
      throw new Error("Every rejected row needs a venueKey and a sourceUrl.");
    }
  }
  return value.rows;
}

/**
 * The rejected list after a reviewer closes a nightly PR: every venue page
 * whose rows the PR added and the committed data does not hold is added once.
 */
export function rejectClosedPrRows(rejectedRows, { prUpdates, committedUpdates, cityVenueKeys, rejectedAt }) {
  const committed = new Set(committedCityPrices(committedUpdates, cityVenueKeys).map(readingId));
  const seen = new Set(rejectedRows.map((row) => `${row.venueKey}|${row.sourceUrl}`));
  const added = [];
  for (const row of committedCityPrices(prUpdates, cityVenueKeys)) {
    const id = `${row.venueKey}|${row.source.url}`;
    if (committed.has(readingId(row)) || seen.has(id)) continue;
    seen.add(id);
    added.push({ venueKey: row.venueKey, sourceUrl: row.source.url, rejectedAt });
  }
  return [...rejectedRows, ...added];
}

/**
 * The prices a reviewer corrected, from the committed `corrected.json` beside
 * the run reports. Each entry is a venue key, drink name and category, and no
 * nightly reading ever overwrites the committed price for one.
 */
export function readCorrectedRows(value) {
  if (value === undefined) return [];
  if (value?.version !== 1 || !Array.isArray(value.rows)) {
    throw new Error("corrected.json must be { version: 1, rows: [...] }.");
  }
  for (const row of value.rows) {
    if (
      typeof row?.venueKey !== "string" ||
      typeof row?.drinkName !== "string" ||
      typeof row?.category !== "string"
    ) {
      throw new Error("Every corrected row needs a venueKey, a drinkName and a category.");
    }
  }
  return value.rows;
}

/**
 * The corrected list after a reviewer edits prices: every city official-site
 * price that holds a different price after the edit than before it is added
 * once.
 */
export function recordCorrectedRows(correctedRows, { beforeUpdates, afterUpdates, cityVenueKeys, correctedAt }) {
  const before = new Map(committedCityPrices(beforeUpdates, cityVenueKeys).map((row) => [priceKey(row), row]));
  const seen = new Set(correctedRows.map(priceKey));
  const added = [];
  for (const row of committedCityPrices(afterUpdates, cityVenueKeys)) {
    const key = priceKey(row);
    const old = before.get(key);
    if (!old || old.priceGbp === row.priceGbp || seen.has(key)) continue;
    seen.add(key);
    added.push({ venueKey: row.venueKey, drinkName: row.drinkName, category: row.category, correctedAt });
  }
  return [...correctedRows, ...added];
}

/**
 * The price updates a git ref holds, such as a closed nightly PR branch. The
 * file grows past git's default 1 MiB pipe buffer after one night, so the
 * buffer is raised well above it.
 */
export function readPriceUpdatesAt(ref, { cwd = ROOT } = {}) {
  const latest = execFileSync("git", ["show", `${ref}:public/data/drink_price_updates/latest.json`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(latest).updates ?? [];
}

/**
 * The saved checkpoint when it still describes this city's pack, or a fresh
 * one. A changed pack or --reset restarts the walk rather than failing every
 * night. The prices found so far carry over, so a night that was paid for and
 * not merged yet is not lost. A price for a pub that left the pack does not
 * carry over.
 */
export function resumeCheckpoint(saved, { city, totalPubs, cityVenueKeys, observedAt, reset = false }) {
  if (
    !reset &&
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
    prices: (Array.isArray(saved?.prices) ? saved.prices : []).filter((row) =>
      cityVenueKeys.has(row?.venueKey),
    ),
    pages: [],
    delegatedChains: [],
  };
}

/**
 * The prices a night writes, with the committed data as the source of truth.
 * Every committed row is kept as it stands, so a price corrected in review is
 * never overwritten. A checkpoint row is kept on top only while no merged
 * night could have carried it: every nightly PR carries every unmerged row
 * read up to that night, so a row read no later than the newest merged night
 * and absent from the committed data was removed or corrected in review. A
 * rejected venue page is never written again, and a corrected price is never
 * overwritten, however new the reading.
 */
export function reconcileWithCommitted(state, { committedPrices, rejectedRows, correctedRows = [], mergedThrough }) {
  const rejected = new Set(rejectedRows.map((row) => `${row.venueKey}|${row.sourceUrl}`));
  const corrected = new Set(correctedRows.map(priceKey));
  const unmerged = state.prices.filter(
    (row) =>
      !(mergedThrough && row.observedAt <= mergedThrough) &&
      !rejected.has(`${row.venueKey}|${row.source?.url}`) &&
      !corrected.has(priceKey(row)),
  );
  return { ...state, prices: mergeCanonicalPrices(committedPrices, unmerged) };
}

/**
 * The read time of the newest night whose PR merged: the newest run report in
 * the committed data. A nightly PR always carries its own run report, so a
 * report on the default branch means that night merged.
 */
export function newestMergedNight(reports) {
  let newest = null;
  for (const report of reports) {
    if (typeof report?.observedAt === "string" && !(newest >= report.observedAt)) newest = report.observedAt;
  }
  return newest;
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
// time.
function mergeState(base, progress, observedAt) {
  const readAt = { ...base.readAt };
  for (const outcome of progress.outcomes ?? []) {
    if (outcome.status !== "failed") readAt[outcome.osmId] = observedAt;
  }
  return {
    ...base,
    readAt,
    totalQueriesSpent: base.totalQueriesSpent + progress.queriesSpent,
    totalCreditsSpent: base.totalCreditsSpent + progress.creditsSpent,
    prices: uniqueBy([...base.prices, ...progress.prices], priceKey),
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
 * One capped pass over a city, stalest pubs first, reconciled with the
 * committed data. A run that searched nothing while a pub was still waiting
 * for a search throws, so a spent-out cap or a broken order is a red job
 * rather than a quiet green one.
 */
export async function runCityPass({
  checkpoint,
  pubs,
  observedAt,
  committedPrices,
  rejectedRows = [],
  correctedRows = [],
  mergedThrough = null,
  onState,
  ...options
}) {
  const runResult = await runCityEnrichment({
    ...options,
    pubs,
    indices: stalestFirst(pubs, checkpoint.readAt),
    observedAt,
    onProgress: (progress) => onState?.(mergeState(checkpoint, progress, observedAt)),
  });
  const state = reconcileWithCommitted(mergeState(checkpoint, runResult, observedAt), {
    committedPrices,
    rejectedRows,
    correctedRows,
    mergedThrough,
  });
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

function writeEvidence(city, state, runResult, cityVenueKeys, observedAt) {
  const generatedAt = new Date().toISOString();
  const stamp = dateStamp(generatedAt);
  const report = {
    version: 1,
    city,
    generatedAt,
    observedAt,
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
  const observedAt = new Date().toISOString();
  const saved = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  const checkpoint = resumeCheckpoint(saved, {
    city: args.city,
    totalPubs: pubs.length,
    cityVenueKeys,
    observedAt,
    reset: args.reset,
  });
  if (saved && checkpoint !== saved) {
    const leftPack = (saved.prices?.length ?? 0) - checkpoint.prices.length;
    console.log(
      `${args.city}: checkpoint restarted; ${checkpoint.prices.length} prices carried over, ` +
        `${leftPack} dropped because their pub left the pack.`,
    );
  }
  const reportDir = path.join(REPORT_ROOT, args.city);
  const mergedThrough = newestMergedNight(
    (existsSync(reportDir) ? readdirSync(reportDir) : [])
      .filter((name) => /^run_\d{8}\.json$/.test(name))
      .map((name) => JSON.parse(readFileSync(path.join(reportDir, name), "utf8"))),
  );
  const rejectedPath = path.join(reportDir, "rejected.json");
  const rejectedRows = readRejectedRows(
    existsSync(rejectedPath) ? JSON.parse(readFileSync(rejectedPath, "utf8")) : undefined,
  );
  const correctedPath = path.join(reportDir, "corrected.json");
  const correctedRows = readCorrectedRows(
    existsSync(correctedPath) ? JSON.parse(readFileSync(correctedPath, "utf8")) : undefined,
  );
  const committedPrices = committedCityPrices(readUpdates(path.join(PRICE_DIR, "latest.json")), cityVenueKeys);

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
    committedPrices,
    rejectedRows,
    correctedRows,
    mergedThrough,
    onState: (next) => {
      if (!args.dryRun) atomicWriteJson(statePath, next);
    },
  });

  if (!args.dryRun) {
    atomicWriteJson(statePath, state);
    writeEvidence(args.city, state, runResult, cityVenueKeys, observedAt);
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
