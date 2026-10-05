#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HARVEST_SOURCES, harvestRedirectLanding, isRefusedOnPermission } from "../lib/harvest/sourcePolicy.ts";
import { createRobotsChecker } from "../lib/harvest/robots.ts";
import { cityVenueIdForPub } from "../lib/cityVenueId.mjs";
import { DISCOVERY_CITIES, POPULATION_SOURCES } from "./lib/parallelDiscoveryCities.mjs";
import { allowedEvidenceUrl, assembleCityDiscoveries, gateVenueEvidence, inCity, parseTaskVenues, postcodeDistricts, postcodeIn, unseenNames, venueBases, validateDiscoveryPack } from "./lib/parallelVenueDiscovery.mjs";
import { createRobotsGate, webSlice } from "./lib/webSlice.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data-harvest/parallel-venue-discovery");
const OUT = path.join(ROOT, "data/parallel-discovery");
const PRICES = { base: 0.01, core: 0.025, pro: 0.10, ultra: 0.30 };
const TAVILY_CREDIT_USD = 0.008;
const FIRECRAWL_CREDIT_USD = 0.005;
// One Firecrawl run may spend at most this many credits, whatever the account holds.
export const FIRECRAWL_RUN_CREDITS = 200;
export const PROVIDERS = ["parallel", "tavily", "firecrawl"];
const ENDPOINTS = {
  parallel: { base: "https://api.parallel.ai", key: "PARALLEL_API_KEY", header: (key) => ({ "x-api-key": key }), exhausted: [402] },
  tavily: { base: "https://api.tavily.com", key: "TAVILY_API_KEY", header: (key) => ({ Authorization: `Bearer ${key}` }), exhausted: [402, 432, 433] },
  firecrawl: { base: "https://api.firecrawl.dev", key: "FIRECRAWL_API_KEY", header: (key) => ({ Authorization: `Bearer ${key}` }), exhausted: [402] },
};
const TASK_INPUT_LIMIT = 24000;
export const CATEGORIES = [
  { id: "pub", label: "pubs" },
  { id: "bar", label: "bars" },
  { id: "cocktail-bar", label: "cocktail bars" },
  { id: "restaurant", label: "restaurants with a bar, wine list, beer or cocktails" },
];
const EXCLUDED = [...new Set([
  "google.com", "google.co.uk", "googleapis.com", "googleusercontent.com", "maps.app.goo.gl", "goo.gl", "g.co", "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com",
  ...HARVEST_SOURCES.filter(isRefusedOnPermission).flatMap((source) => [new URL(source.url).hostname, ...(source.renderedMenuHosts ?? [])]),
])];
const SOURCE_POLICY = { exclude_domains: EXCLUDED };
const strings = { type: "string" };
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["venues"], properties: {
    venues: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["name", "kind", "address", "website", "lat", "lng", "evidence"],
      properties: {
        name: strings, kind: { type: "string", enum: ["pub", "bar", "restaurant"] }, address: strings,
        website: { type: ["string", "null"] }, lat: { type: ["number", "null"] }, lng: { type: ["number", "null"] },
        evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["url", "excerpt"], properties: { url: strings, excerpt: strings } } },
      },
    } },
  },
};

export function parseArgs(argv) {
  const options = { cities: null, matches: 30, concurrency: 40, processor: "pro", provider: "parallel", list: false, refresh: false, recheckPermissions: false, help: false, check: false };
  for (const arg of argv) {
    if (arg === "--recheck-permissions") options.recheckPermissions = true;
    else if (["--list", "--refresh", "--help", "--check"].includes(arg)) options[arg.slice(2)] = true;
    else if (arg.startsWith("--cities=")) options.cities = arg.slice(9) ? arg.slice(9).split(",") : [];
    else if (arg.startsWith("--matches=")) options.matches = Number(arg.slice(10));
    else if (arg.startsWith("--concurrency=")) options.concurrency = Number(arg.slice(14));
    else if (arg.startsWith("--processor=")) options.processor = arg.slice(12);
    else if (arg.startsWith("--provider=")) options.provider = arg.slice(11);
    else throw new Error(`Unknown argument ${arg}; run node scripts/discover_parallel_venues.mjs --help`);
  }
  for (const key of ["matches", "concurrency"]) if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`Invalid ${key}; use a positive integer`);
  if (!Object.hasOwn(PRICES, options.processor)) throw new Error("Invalid processor; choose base, core, pro or ultra");
  if (!PROVIDERS.includes(options.provider)) throw new Error("Invalid provider; choose parallel, tavily or firecrawl");
  if (options.cities?.some((id) => !DISCOVERY_CITIES.some((city) => city.id === id))) throw new Error("Unknown city; run node scripts/discover_parallel_venues.mjs --list");
  return options;
}

// The one place Task input is fitted to Parallel's input limit.
export function taskRequest({ objective, context, known, processor }) {
  const names = [...new Set(known.map((row) => `${row.name}${row.postcode ? ` (${row.postcode})` : ""}`))];
  const body = {
    processor, source_policy: SOURCE_POLICY,
    input: { objective, ...context, knownVenueNames: [], contextIsPartial: false, totalKnownVenues: names.length },
    task_spec: { output_schema: { type: "json", json_schema: SCHEMA } },
  };
  let size = JSON.stringify({ input: body.input, task_spec: body.task_spec }).length;
  for (const name of names) {
    size += JSON.stringify(name).length + 1;
    if (size > TASK_INPUT_LIMIT) break;
    body.input.knownVenueNames.push(name);
  }
  body.input.contextIsPartial = body.input.knownVenueNames.length !== names.length;
  if (JSON.stringify({ input: body.input, task_spec: body.task_spec }).length > TASK_INPUT_LIMIT) throw new Error("Task context exceeds documented input limit; no request sent");
  return body;
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temporary, file);
}

const exhausted = new Set();
async function providerRequest(provider, endpoint, { city, body, cost = () => 0, timeoutMs = 60_000, pending = false } = {}) {
  const config = ENDPOINTS[provider];
  const key = process.env[config.key];
  if (!key) throw new Error(`${config.key} is missing; load it in the invoking shell`);
  if (body && exhausted.has(provider)) throw new Error(`${provider} account has insufficient credit; no further paid requests sent`);
  for (let attempt = 1; ; attempt += 1) {
    const startedAt = new Date().toISOString();
    let status = "network-error";
    let usage = null;
    let runId = null;
    let estimatedCostUsd = 0;
    try {
      const response = await fetch(`${config.base}${endpoint}`, {
        method: body ? "POST" : "GET",
        headers: { ...config.header(key), "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs), redirect: "error",
      });
      status = response.status;
      if (pending && status === 408) return null;
      if (status === 429 && attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, (Number(response.headers.get("retry-after")) || 15 * attempt) * 1000));
        continue;
      }
      if (config.exhausted.includes(status)) exhausted.add(provider);
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        const details = Array.isArray(failure.detail) ? failure.detail.map((item) => ({ path: item.loc, type: item.type })) : [];
        throw Object.assign(new Error(`${provider} ${endpoint.split("?")[0]} HTTP ${status}; validation=${JSON.stringify(details)}; checkpoint retained, rerun to resume`), { status });
      }
      const data = await response.json();
      const scrape = data.data?.metadata;
      usage = data.usage ?? (scrape?.creditsUsed === undefined ? null : { credits: scrape.creditsUsed });
      runId = data.run_id ?? data.request_id ?? scrape?.scrapeId ?? null;
      estimatedCostUsd = cost(data);
      return data;
    } finally {
      await appendFile(path.join(OUT, "usage.jsonl"), `${JSON.stringify({ startedAt, provider, city, endpoint, status, runId, usage, estimatedCostUsd })}\n`);
    }
  }
}

const parallelRequest = (endpoint, options) => providerRequest("parallel", endpoint, options);

async function baseVenues() {
  const pack = async (file) => {
    const read = await readJson(path.join(ROOT, "data/osm/uk", file));
    if (!read) throw new Error(`Missing national dedupe input data/osm/uk/${file}`);
    return read.pubs ?? read.venues ?? [];
  };
  const [ukPubs, ukDrink, ukFood, ukWork] = await Promise.all(["uk_osm_pubs.json", "uk_osm_venues_drink.json", "uk_osm_venues_food.json", "uk_osm_venues_work.json"].map(pack));
  const cityPubs = [];
  for (const city of DISCOVERY_CITIES) cityPubs.push(...((await readJson(path.join(ROOT, "data/cities", city.id, "osm_pubs.json")))?.pubs ?? []));
  const london = await readJson(path.join(ROOT, "public/data/pint_prices_app_dataset.json"));
  return venueBases({ ukPubs, ukDrink, ukFood, ukWork, cityPubs, london });
}

const discoveryPath = (city) => path.join(ROOT, "data/cities", city.id, "parallel_venues.json");

const geocodes = new Map();
function geocode(candidate, city) {
  if (candidate.lat !== null && candidate.lng !== null) return candidate;
  const postcode = candidate.postcode;
  if (!geocodes.has(postcode)) geocodes.set(postcode, (async () => {
    const cacheFile = path.join(RAW, "postcodes", `${postcode.replace(/\s/g, "")}.json`);
    let cached = await readJson(cacheFile);
    if (!cached) {
      const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
      if (!response.ok && response.status !== 404) throw new Error(`Postcode geocoding HTTP ${response.status}`);
      cached = { url, observedAt: new Date().toISOString(), response: await response.json() };
      await writeJson(cacheFile, cached);
    }
    return cached;
  })());
  return geocodes.get(postcode).then((cached) => {
    const point = cached.response?.result;
    if (!point || !inCity(point.latitude, point.longitude, city)) return null;
    return { ...candidate, lat: point.latitude, lng: point.longitude, coordinatePrecision: "postcode-centroid", geocode: { url: cached.url, observedAt: cached.observedAt, postcode, quality: point.quality } };
  });
}

async function awaitResult(entry, city) {
  for (;;) {
    let response;
    try {
      response = await parallelRequest(`/v1/tasks/runs/${entry.runId}/result?timeout=240`, { city: city.id, timeoutMs: 280_000, pending: true });
    } catch (error) {
      if (error.status === 404) throw Object.assign(new Error(`Parallel Task ${entry.runId} failed; rerun to start another observation`), { failedRun: true });
      throw error;
    }
    if (!response) continue;
    const resultPath = path.join(RAW, city.id, `${entry.runId}-result.json`);
    await writeJson(resultPath, response);
    entry.observedAt = new Date().toISOString();
    entry.resultPath = path.relative(ROOT, resultPath);
    return;
  }
}

// Pages a district/category slice until a page names no venue beyond the
// district's known venues and the slice's earlier pages. A failed slice still
// hands back the verified rows of the pages it completed. Without a Parallel
// spend it replays the pages already paid for and stays incomplete.
async function parallelSlice({ city, district, category, districtKnown }, options, spend) {
  const file = path.join(RAW, city.id, `${district}-${category.id}.json`);
  const state = (options.refresh ? null : await readJson(file)) ?? { city: city.id, district, category: category.id, pages: [] };
  const found = [];
  const rejected = [];
  const seen = [];
  let researched = 0;
  const outcome = (complete) => ({ found, rejected, researched, taskRuns: state.pages.filter((entry) => entry.resultPath).length, complete });
  try {
  for (let page = 0; ; page += 1) {
    if (!spend && !state.pages[page]?.resultPath) return outcome(false);
    if (!state.pages[page]) {
      const run = await parallelRequest("/v1/tasks/runs", { city: city.id, cost: () => PRICES[options.processor], body: taskRequest({
        processor: options.processor, known: [...districtKnown, ...seen],
        objective: `List every currently operating ${category.label} serving alcoholic drinks in UK postcode district ${district} (${city.displayName}) that is missing from knownVenueNames, up to ${options.matches}. Search the whole district, including side streets, recently opened and independent venues. Each row must represent one venue at one address. Use its own site or a reputable venue directory. No Google Maps/Places content, ratings, reviews, hours or prices. Restaurants need explicit beer, wine-list, cocktail or alcoholic drinks evidence. Include the complete address and full UK postcode. Set coordinates to null unless a cited page explicitly states them. website must be the venue's own site or null. Evidence must be short verbatim excerpts from cited pages that together state this venue's name, full street address, postcode and pub/bar/alcohol service. Do not invent or paraphrase excerpts. Cite each list element in research basis with original excerpts. Keep each excerpt under 240 characters. Never infer an address or serving alcohol. Omit closed venues or unverifiable rows. Return an empty list when no further venue can be verified.`,
        context: { city: city.displayName, postcodeDistrict: district, category: category.label, bbox: city.bbox },
      }) });
      if (!run.run_id) throw new Error("Parallel Task create response has no run_id");
      state.pages.push({ runId: run.run_id, processor: options.processor });
      await writeJson(file, state);
    }
    const entry = state.pages[page];
    if (!entry.resultPath) {
      try { await awaitResult(entry, city); }
      catch (error) { if (error.failedRun) { state.pages.pop(); await writeJson(file, state); } throw error; }
      await writeJson(file, state);
    }
    const result = await readJson(path.join(ROOT, entry.resultPath));
    const parsed = parseTaskVenues(result, city, entry.observedAt);
    const rows = result.output.content.venues;
    researched += rows.length;
    const fresh = unseenNames(rows, [...districtKnown, ...seen]);
    seen.push(...rows.filter((row) => fresh.includes(row?.name)).map((row) => ({ name: row.name, postcode: postcodeIn(row.address) })));
    rejected.push(...parsed.rejected);
    for (const candidate of parsed.candidates) {
      const row = await geocode(candidate, city);
      if (row) found.push({ ...row, provider: "parallel", runId: entry.runId });
      else rejected.push({ name: candidate.name, reason: "postcode-does-not-geocode-inside-city" });
    }
    if (!fresh.length) break;
  }
  } catch (error) { throw Object.assign(error, { partial: outcome(false) }); }
  return outcome(true);
}

function limiter(size) {
  let active = 0;
  const waiting = [];
  return async (task) => {
    while (active >= size) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try { return await task(); }
    finally { active -= 1; waiting.shift()?.(); }
  };
}
const tavilySlot = limiter(4);
const firecrawlSlot = limiter(4);
let firecrawlCredits = 0;
const robotsGate = createRobotsGate(() => createRobotsChecker());
const permissionSlot = limiter(12);
const permissionChecks = new Map();
let recheckPermissions = false;

// Cached research still needs recorded permission before publication. Refresh
// checks permission live; keyless replay uses the same recorded answer.
async function evidencePermission(url) {
  if (!permissionChecks.has(url)) permissionChecks.set(url, permissionSlot(async () => {
    const file = path.join(RAW, "permissions", `${createHash("sha256").update(url).digest("hex")}.json`);
    const cached = recheckPermissions ? null : await readJson(file);
    const decision = cached?.url === url ? cached : { url, ...(await robotsGate(url)), checkedAt: new Date().toISOString() };
    if (!cached) await writeJson(file, decision);
    return decision;
  }));
  return permissionChecks.get(url);
}

const pageFile = (url) => path.join(RAW, "pages", `${createHash("sha256").update(url).digest("hex").slice(0, 24)}.json`);

// The page's own status, asked once a Tavily read fails without a cause.
async function probePage(url) {
  try {
    const response = await fetch(url, { headers: { "user-agent": "PUBMAXX-harvest/1", accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    response.body?.cancel().catch(() => {});
    return { status: response.status, landed: harvestRedirectLanding(url, response.url).outcome === "refused" || !allowedEvidenceUrl(response.url) ? "refused" : "permitted", checkedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

function webIo({ city, district, category }) {
  const file = path.join(RAW, city.id, `${district}-${category.id}.web.json`);
  return {
    now: () => new Date().toISOString(),
    loadState: () => readJson(file),
    saveState: (state) => writeJson(file, state),
    search: (query) => tavilySlot(() => providerRequest("tavily", "/search", { city: city.id, cost: (data) => (data.usage?.credits ?? 1) * TAVILY_CREDIT_USD,
      body: { query, search_depth: "basic", max_results: 20, include_raw_content: "text", exclude_domains: EXCLUDED, country: "united kingdom", include_usage: true } })),
    saveSearch: async (index, response) => {
      const resultPath = path.join(RAW, city.id, "tavily", `${district}-${category.id}-${index}.json`);
      await writeJson(resultPath, response);
      return path.relative(ROOT, resultPath);
    },
    readSearch: (resultPath) => readJson(path.join(ROOT, resultPath)),
    robots: robotsGate,
    storedPage: (url) => readJson(pageFile(url)),
    storePage: (url, page) => writeJson(pageFile(url), page),
    extract: (urls, depth) => tavilySlot(() => providerRequest("tavily", "/extract", { city: city.id, timeoutMs: 120_000, cost: (data) => (data.usage?.credits ?? 0) * TAVILY_CREDIT_USD,
      body: { urls, extract_depth: depth, format: "markdown", timeout: depth === "advanced" ? 60 : 30, include_usage: true } })),
    probe: probePage,
    geocode: (candidate) => geocode(candidate, city),
  };
}

const FIRECRAWL_READER = { provider: "firecrawl", label: "Firecrawl scrape", failed: "failed", depths: ["basic"] };

// One Firecrawl scrape per page, markdown only, the whole page so a footer
// address is kept. A PDF costs a credit per page, so it is read to at most
// FIRECRAWL_PDF_PAGES pages, and each scrape holds that many credits against
// the run cap until Firecrawl reports what it used. The answer is shaped like a
// Tavily Extract response so the slice reads, settles and skips it by the same
// rules.
const FIRECRAWL_PDF_PAGES = 5;
async function firecrawlRead(url, city) {
  if (firecrawlCredits + FIRECRAWL_PDF_PAGES > FIRECRAWL_RUN_CREDITS) throw new Error(`Firecrawl run cap of ${FIRECRAWL_RUN_CREDITS} credits reached; checkpoint retained, rerun to resume`);
  firecrawlCredits += FIRECRAWL_PDF_PAGES;
  let used = FIRECRAWL_PDF_PAGES;
  try {
    const data = await firecrawlSlot(() => providerRequest("firecrawl", "/v2/scrape", { city: city.id, timeoutMs: 120_000,
      cost: (body) => (body.data?.metadata?.creditsUsed ?? FIRECRAWL_PDF_PAGES) * FIRECRAWL_CREDIT_USD,
      body: { url, formats: ["markdown"], onlyMainContent: false, timeout: 60_000, parsers: [{ type: "pdf", maxPages: FIRECRAWL_PDF_PAGES }], location: { country: "GB", languages: ["en-GB"] } } }));
    const metadata = data.data?.metadata ?? {};
    used = Number(metadata.creditsUsed ?? FIRECRAWL_PDF_PAGES);
    const status = Number(metadata.statusCode);
    if (Number.isFinite(status) && status >= 400) return { failed_results: [{ url, status, error: `page HTTP ${status}` }] };
    const markdown = data.data?.markdown;
    if (typeof markdown !== "string" || !markdown.trim()) return { failed_results: [{ url, error: "Firecrawl returned no markdown" }] };
    return { results: [{ url, landed_url: metadata.url ?? url, raw_content: markdown }] };
  } catch (error) {
    if (Number.isFinite(error.status)) used = 0;
    // Firecrawl's 4xx or 5xx for one page is that page's failed read; only an
    // exhausted account, a timeout or a rate limit stops the run.
    if (error.status >= 400 && ![402, 408, 429].includes(error.status)) return { failed_results: [{ url, status: error.status, error: `Firecrawl HTTP ${error.status}` }] };
    throw error;
  } finally {
    firecrawlCredits += used - FIRECRAWL_PDF_PAGES;
  }
}

function firecrawlIo(slice) {
  return {
    ...webIo(slice),
    search: () => { throw new Error("The Firecrawl lane reads skipped sources only; it never searches"); },
    reader: FIRECRAWL_READER,
    extract: async (urls) => {
      const reads = await Promise.allSettled(urls.map((url) => firecrawlRead(url, slice.city)));
      const answers = reads.flatMap((read) => (read.status === "fulfilled" ? [read.value] : []));
      const response = { results: answers.flatMap((answer) => answer.results ?? []), failed_results: answers.flatMap((answer) => answer.failed_results ?? []) };
      const failed = reads.find((read) => read.status === "rejected");
      if (failed) throw Object.assign(failed.reason, { answered: response });
      return response;
    },
  };
}

// Parallel pages already paid for always count. A slice they leave
// incomplete is finished by the Tavily lane when it may spend.
const LANES = { parallel: parallelSlice, web: (slice, options) => webSlice(slice, options, options.skipsOnly ? firecrawlIo(slice) : webIo(slice)) };

// A city outside --cities never spends and never refreshes: both lanes replay
// what is cached, so its reports keep their completion, skips and filters.
// Only the lane that can research again is refreshed, so paid Parallel pages
// always count when the run spends on Tavily.
export async function runSlice(slice, options, lanes = LANES) {
  const spend = !options.cities || options.cities.includes(slice.city.id);
  const refresh = options.refresh && spend;
  const parallel = await lanes.parallel(slice, { ...options, refresh: refresh && options.provider === "parallel" }, spend && options.provider === "parallel");
  if (parallel.complete) return parallel;
  const merge = (web) => ({ ...web, found: [...parallel.found, ...web.found], rejected: [...parallel.rejected, ...web.rejected],
    researched: parallel.researched + web.researched, taskRuns: parallel.taskRuns });
  const webSpend = spend && ["tavily", "firecrawl"].includes(options.provider);
  try { return merge(await lanes.web(slice, { spend: webSpend, refresh: refresh && options.provider === "tavily", skipsOnly: options.provider === "firecrawl" })); }
  catch (error) { throw Object.assign(error, { partial: merge(error.partial ?? { found: [], rejected: [], researched: 0, complete: false }) }); }
}

async function pool(items, size, work) {
  const results = new Array(items.length);
  const failures = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await work(items[index]); }
      catch (error) {
        results[index] = error.partial ? { ...error.partial, failure: error.message } : null;
        failures.push(`${items[index].city.id}/${items[index].district}/${items[index].category.id}: ${error.message}`);
      }
    }
  }));
  return { results, failures };
}

async function assembleCity(city, slices, results, shipped) {
  const own = slices.map((slice, index) => ({ slice, result: results[index] ?? { found: [], rejected: [], researched: 0, taskRuns: 0, complete: false } })).filter(({ slice }) => slice.city === city);
  const found = own.flatMap(({ result }) => result.found);
  const previous = (await readJson(discoveryPath(city), { venues: [] })).venues.map((row) => ({ ...row, provider: row.provider ?? "parallel" }));
  const others = [];
  for (const other of DISCOVERY_CITIES) if (other !== city) others.push(...((await readJson(discoveryPath(other)))?.venues ?? []));
  const assembled = assembleCityDiscoveries({ found, previous, existing: [...shipped, ...others], city });
  for (const row of assembled.accepted) row.id = cityVenueIdForPub(city.id, row);
  const permitted = await gateVenueEvidence(assembled.venues, city, evidencePermission);
  const permittedIds = new Set(permitted.venues.map((row) => row.id));
  const pack = validateDiscoveryPack({ city: city.id, source: "Parallel Task API; Tavily Search and Extract",
    observationMeaning: "Each row's observedAt is the date its Parallel research result, Tavily search page text or page read was retrieved; provider names the lane. Cached reruns retain that date. Not a claim that the venue is open tonight.",
    populationPriority: city.population, populationSources: POPULATION_SOURCES, venues: permitted.venues }, city);
  if (pack.venues.length || previous.length) await writeJson(discoveryPath(city), pack);
  const report = { city: city.id, districts: new Set(own.map(({ slice }) => slice.district)).size, slices: own.length,
    slicesComplete: own.filter(({ result }) => result.complete).length,
    incompleteSlices: own.filter(({ result }) => !result.complete).map(({ slice, result }) => `${slice.district}/${slice.category.id}${result.failure ? `: ${result.failure}` : ""}`),
    skippedSources: own.flatMap(({ slice, result }) => (result.skips ?? []).map((skip) => ({ district: slice.district, category: slice.category.id, ...skip }))),
    filteredSources: own.flatMap(({ slice, result }) => (result.filtered ?? []).map((source) => ({ district: slice.district, category: slice.category.id, ...source }))),
    taskRuns: own.reduce((total, { result }) => total + result.taskRuns, 0),
    webSearches: own.reduce((total, { result }) => total + (result.webSearches ?? 0), 0),
    pagesRead: own.reduce((total, { result }) => total + (result.pagesRead ?? 0), 0),
    researched: own.reduce((total, { result }) => total + result.researched, 0),
    added: assembled.accepted.filter((row) => permittedIds.has(row.id)).length, retained: assembled.retained.filter((row) => permittedIds.has(row.id)), totalAccepted: pack.venues.length, repeats: assembled.repeats,
    duplicates: assembled.duplicates, withdrawn: [...assembled.withdrawn, ...permitted.rejected], permissionRejected: permitted.rejected.length, rejected: own.flatMap(({ result }) => result.rejected),
    outputPath: path.relative(ROOT, discoveryPath(city)) };
  await writeJson(path.join(OUT, "reports", `${city.id}.json`), report);
  console.log(`city: ${city.id}\nadded: ${report.added}\ntotal: ${report.totalAccepted}\nslicesComplete: ${report.slicesComplete}/${report.slices}\ntaskRuns: ${report.taskRuns}\nwebSearches: ${report.webSearches}\npagesRead: ${report.pagesRead}`);
  return report;
}

async function checkPacks({ publishFreshness = false } = {}) {
  const recorded = publishFreshness ? null : await readJson(path.join(OUT, "permissions.json"));
  const permitted = new Set((recorded?.urls ?? []).filter((row) => row.outcome === "allowed" && Number.isFinite(Date.parse(row.checkedAt))).map((row) => row.url));
  let venues = 0;
  const cities = [];
  const dates = [];
  for (const city of DISCOVERY_CITIES) {
    const pack = await readJson(discoveryPath(city));
    if (!pack) continue;
    validateDiscoveryPack(pack, city);
    if (!publishFreshness && pack.venues.some((row) => row.sourceUrls.some((url) => !permitted.has(url)))) throw new Error(`Missing recorded source permission for ${city.id}`);
    dates.push(...pack.venues.map((venue) => venue.observedAt));
    venues += pack.venues.length;
    cities.push({ city: city.id, venues: pack.venues.length });
  }
  if (!dates.length) throw new Error("No accepted observations to validate or date");
  const oldestObservedAt = dates.reduce((oldest, date) => Date.parse(date) < Date.parse(oldest) ? date : oldest);
  const freshness = { source: "Parallel venue discovery", oldestObservedAt, venues, cities };
  const file = path.join(OUT, "freshness.json");
  if (publishFreshness) await writeJson(file, freshness);
  else if (JSON.stringify(await readJson(file)) !== JSON.stringify(freshness)) throw new Error("Discovery freshness differs from per-row observations; rerun cached discovery to rebuild");
  console.log(`validatedCities: ${cities.length}\nvalidatedVenues: ${venues}\noldestObservedAt: ${oldestObservedAt}`);
}

async function usageSummary() {
  const calls = (await readFile(path.join(OUT, "usage.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const byEndpoint = {};
  const byCity = {};
  for (const call of calls) {
    const provider = call.provider ?? "parallel";
    const key = `${provider} ${call.endpoint.split("?")[0].replace(/\/trun_[^/]+/, "/{run_id}")} ${call.status}`;
    byEndpoint[key] = (byEndpoint[key] ?? 0) + 1;
    const city = (byCity[call.city ?? "none"] ??= {});
    const entry = (city[provider] ??= { calls: 0, credits: 0, estimatedCostUsd: 0 });
    entry.calls += 1;
    entry.credits += provider === "parallel" ? 0 : (call.usage?.credits ?? 0);
    entry.estimatedCostUsd = Number((entry.estimatedCostUsd + call.estimatedCostUsd).toFixed(3));
  }
  return { calls: calls.length, byEndpoint, byCity, estimatedCostUsd: Number(calls.reduce((total, call) => total + call.estimatedCostUsd, 0).toFixed(3)) };
}

async function main() {
  if (process.argv.length === 3 && ["-v", "-V", "--version"].includes(process.argv[2])) { console.log("2.0.0"); return; }
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: node scripts/discover_parallel_venues.mjs [--provider=<parallel|tavily|firecrawl>] [--cities=<id,id>] [--matches=<n>] [--concurrency=<n>] [--processor=<base|core|pro|ultra>] [--refresh] [--recheck-permissions] [--list] [--check]\ndefaults: every city map, one slice per postcode district and category, parallel provider, 30 candidates per Task page, 40 concurrent slices, pro processor, resume cached runs\n--cities: only these cities may spend, first; every city is still replayed and reported. --cities= replays every city without provider requests or keys; missing permission records require robots checks\n--recheck-permissions: checks every retained evidence URL live without refreshing research\n--provider=firecrawl: never searches; asks robots again and reads through Firecrawl only the sources earlier runs skipped, at most " + FIRECRAWL_RUN_CREDITS + " credits per run\ncredentials: PARALLEL_API_KEY, TAVILY_API_KEY or FIRECRAWL_API_KEY from environment, required before any run; --check and --list are keyless\nexamples[3]:\n  node scripts/discover_parallel_venues.mjs --list\n  node scripts/discover_parallel_venues.mjs --provider=tavily --cities=manchester,liverpool\n  node scripts/discover_parallel_venues.mjs --check");
    return;
  }
  if (options.check) { await checkPacks(); return; }
  const spending = (city) => !options.cities || options.cities.includes(city.id);
  const targets = [...DISCOVERY_CITIES.filter(spending), ...DISCOVERY_CITIES.filter((city) => !spending(city))];
  if (options.list || process.argv.length === 2) {
    console.log(`cities[${targets.length}]{id,population}:\n${targets.map((city) => `  ${city.id},${city.population}`).join("\n")}\nhelp: node scripts/discover_parallel_venues.mjs --cities=birmingham,leeds,glasgow`);
    return;
  }
  const key = ENDPOINTS[options.provider].key;
  if (options.cities?.length !== 0 && !process.env[key]) throw new Error(`${key} is missing; load it in the invoking shell. A keyless replay would record a credential failure as the run's outcome`);
  // A Firecrawl run reads only skipped sources, so recorded permission for
  // published evidence replays unless asked again explicitly.
  recheckPermissions = options.recheckPermissions || (options.provider !== "firecrawl" && (options.refresh || options.cities?.length !== 0));
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const { known, shipped } = await baseVenues();
  const slices = targets.flatMap((city) => {
    const cityKnown = known.filter((row) => inCity(row.lat, row.lng, city));
    return postcodeDistricts(cityKnown, city).flatMap((district) => {
      const districtKnown = cityKnown.filter((row) => (postcodeIn(row.postcode) ?? postcodeIn(row.address))?.split(" ")[0] === district)
        .map((row) => ({ name: row.name, postcode: postcodeIn(row.postcode) ?? postcodeIn(row.address) }));
      return CATEGORIES.map((category) => ({ city, district, category, districtKnown }));
    });
  });
  console.log(`cities: ${targets.length}\nslices: ${slices.length}`);
  const { results, failures } = await pool(slices, options.concurrency, (slice) => runSlice(slice, options));
  const cities = [];
  for (const city of DISCOVERY_CITIES) cities.push(await assembleCity(city, slices, results, shipped));
  await checkPacks({ publishFreshness: true });
  const permissions = await Promise.all([...permissionChecks.values()]);
  await writeJson(path.join(OUT, "permissions.json"), {
    meaning: "Every published venue retains only evidence URLs with recorded robots permission. Refused and unreachable URLs cannot support identity, address, coordinates or drinking evidence. checkedAt records permission checks, not venue observation dates.",
    checkedUrls: permissions.length, allowedUrls: permissions.filter((row) => row.outcome === "allowed").length,
    rejectedVenues: cities.reduce((sum, row) => sum + row.permissionRejected, 0),
    urls: permissions.sort((a, b) => a.url.localeCompare(b.url)),
  });
  const usage = await usageSummary();
  const observed = (await Promise.all(DISCOVERY_CITIES.map(async (city) => ((await readJson(discoveryPath(city)))?.venues ?? []).map((row) => row.observedAt)))).flat().sort();
  await writeJson(path.join(OUT, "summary.json"), { providers: PROVIDERS, parallelProcessor: options.processor, parallelMatchesPerPage: options.matches, categories: CATEGORIES.map((category) => category.id),
    oldestObservedAt: observed[0] ?? null, newestObservedAt: observed.at(-1) ?? null,
    cities: cities.map(({ city, districts, slices: count, slicesComplete, skippedSources, filteredSources, taskRuns, webSearches, pagesRead, researched, added, retained, totalAccepted, duplicates, rejected }) => ({ city, complete: slicesComplete === count, districts, slices: count, slicesComplete, slicesWithSkips: new Set(skippedSources.map((skip) => `${skip.district}/${skip.category}`)).size, skippedSources: skippedSources.length, robotsSkips: skippedSources.filter((skip) => skip.kind === "robots").length, extractSkips: skippedSources.filter((skip) => skip.kind === "extract").length, filteredSources: filteredSources.length, taskRuns, webSearches, pagesRead, researched, added, retained: retained.length, duplicates: duplicates.length, rejected: rejected.length, totalAccepted, usage: usage.byCity[city] ?? {} })),
    allCitiesComplete: cities.every((city) => city.slicesComplete === city.slices), failedSlices: failures.length, firstFailure: failures[0] ?? null, usage });
  await writeJson(path.join(OUT, "skips.json"), { meaning: "Sources not read. kind robots: robots.txt could not be reached (timeout, DNS failure, 429 or 5xx) on the first ask and two retries; robots was never assumed to allow. kind extract: Tavily Extract could not read the page at basic or advanced depth, and the page's own status did not settle it as gone or refused. No skipped source is evidence for any venue, and a slice complete with skips is not exhaustive coverage.",
    skips: cities.flatMap(({ city, skippedSources }) => skippedSources.map((skip) => ({ city, ...skip }))) });
  console.log(`calls: ${usage.calls}\nestimatedCostUsd: ${usage.estimatedCostUsd.toFixed(3)}\nhelp: npm run build:city-slim && npm run validate-data`);
  if (failures.length) throw new Error(`${failures.length} slices failed; verified rows so far are published, checkpoints retained, rerun to resume. First: ${failures[0]}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.log(`error: ${JSON.stringify(error.message)}`); process.exitCode = 1; });
}
