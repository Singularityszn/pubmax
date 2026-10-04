#!/usr/bin/env node
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HARVEST_SOURCES, isRefusedOnPermission } from "../lib/harvest/sourcePolicy.ts";
import { cityVenueIdForPub } from "../lib/cityVenueId.mjs";
import { DISCOVERY_CITIES, POPULATION_SOURCES } from "./lib/parallelDiscoveryCities.mjs";
import { assembleCityDiscoveries, inCity, parseTaskVenues, postcodeDistricts, postcodeIn, unseenNames, validateDiscoveryPack } from "./lib/parallelVenueDiscovery.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data-harvest/parallel-venue-discovery");
const OUT = path.join(ROOT, "data/parallel-discovery");
const API = "https://api.parallel.ai";
const PRICES = { base: 0.01, core: 0.025, pro: 0.10, ultra: 0.30 };
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
  const options = { cities: null, matches: 30, concurrency: 40, processor: "pro", list: false, refresh: false, help: false, check: false };
  for (const arg of argv) {
    if (["--list", "--refresh", "--help", "--check"].includes(arg)) options[arg.slice(2)] = true;
    else if (arg.startsWith("--cities=")) options.cities = arg.slice(9).split(",");
    else if (arg.startsWith("--matches=")) options.matches = Number(arg.slice(10));
    else if (arg.startsWith("--concurrency=")) options.concurrency = Number(arg.slice(14));
    else if (arg.startsWith("--processor=")) options.processor = arg.slice(12);
    else throw new Error(`Unknown argument ${arg}; run node scripts/discover_parallel_venues.mjs --help`);
  }
  for (const key of ["matches", "concurrency"]) if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`Invalid ${key}; use a positive integer`);
  if (!Object.hasOwn(PRICES, options.processor)) throw new Error("Invalid processor; choose base, core, pro or ultra");
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

let insufficientCredit = false;
async function parallelRequest(endpoint, { city, body, cost = 0, timeoutMs = 60_000, pending = false } = {}) {
  if (!process.env.PARALLEL_API_KEY) throw new Error("PARALLEL_API_KEY is missing; load it in the invoking shell");
  if (body && insufficientCredit) throw new Error("Parallel account has insufficient credit; no further runs requested");
  const startedAt = new Date().toISOString();
  let status = "network-error";
  let usage = null;
  let runId = null;
  try {
    const response = await fetch(`${API}${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: { "x-api-key": process.env.PARALLEL_API_KEY, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs), redirect: "error",
    });
    status = response.status;
    if (pending && status === 408) return null;
    if (status === 402) insufficientCredit = true;
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const details = Array.isArray(failure.detail) ? failure.detail.map((item) => ({ path: item.loc, type: item.type })) : [];
      throw Object.assign(new Error(`Parallel ${endpoint.split("?")[0]} HTTP ${status}; validation=${JSON.stringify(details)}; checkpoint retained, rerun to resume`), { status });
    }
    const data = await response.json();
    usage = data.usage ?? null;
    runId = data.run_id ?? data.run?.run_id ?? null;
    return data;
  } finally {
    await appendFile(path.join(OUT, "usage.jsonl"), `${JSON.stringify({ startedAt, city, endpoint, status, runId, usage, estimatedCostUsd: status === 200 || status === 201 || status === 202 ? cost : 0 })}\n`);
  }
}

async function baseVenues() {
  const venues = [];
  for (const file of ["uk_osm_pubs.json", "uk_osm_venues_drink.json", "uk_osm_venues_food.json", "uk_osm_venues_work.json"]) {
    const pack = await readJson(path.join(ROOT, "data/osm/uk", file));
    if (!pack) throw new Error(`Missing national dedupe input data/osm/uk/${file}`);
    venues.push(...(pack.pubs ?? pack.venues ?? []));
  }
  for (const city of DISCOVERY_CITIES) {
    const pack = await readJson(path.join(ROOT, "data/cities", city.id, "osm_pubs.json"));
    venues.push(...(pack?.pubs ?? []));
  }
  const london = await readJson(path.join(ROOT, "public/data/pint_prices_app_dataset.json"));
  venues.push(...london.map((row) => ({ name: row.pub_name, lat: row.latitude, lng: row.longitude, address: row.address })));
  return venues.filter((row) => row.name && Number.isFinite(row.lat) && Number.isFinite(row.lng));
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
// hands back the verified rows of the pages it completed.
async function runSlice({ city, district, category, districtKnown }, options) {
  const file = path.join(RAW, city.id, `${district}-${category.id}.json`);
  const state = (options.refresh ? null : await readJson(file)) ?? { city: city.id, district, category: category.id, pages: [] };
  const found = [];
  const rejected = [];
  const seen = [];
  let researched = 0;
  const outcome = (complete) => ({ found, rejected, researched, taskRuns: state.pages.filter((entry) => entry.resultPath).length, complete });
  try {
  for (let page = 0; ; page += 1) {
    if (!state.pages[page]) {
      const run = await parallelRequest("/v1/tasks/runs", { city: city.id, cost: PRICES[options.processor], body: taskRequest({
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
      if (row) found.push({ ...row, runId: entry.runId });
      else rejected.push({ name: candidate.name, reason: "postcode-does-not-geocode-inside-city" });
    }
    if (!fresh.length) break;
  }
  } catch (error) { throw Object.assign(error, { partial: outcome(false) }); }
  return outcome(true);
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
        results[index] = error.partial ?? null;
        failures.push(`${items[index].city.id}/${items[index].district}/${items[index].category.id}: ${error.message}`);
      }
    }
  }));
  return { results, failures };
}

async function assembleCity(city, slices, results, base) {
  const own = slices.map((slice, index) => ({ slice, result: results[index] ?? { found: [], rejected: [], researched: 0, taskRuns: 0, complete: false } })).filter(({ slice }) => slice.city === city);
  const found = own.flatMap(({ result }) => result.found);
  const previous = (await readJson(discoveryPath(city), { venues: [] })).venues;
  const others = [];
  for (const other of DISCOVERY_CITIES) if (other !== city) others.push(...((await readJson(discoveryPath(other)))?.venues ?? []));
  const assembled = assembleCityDiscoveries({ found, previous, existing: [...base, ...others], city });
  for (const row of assembled.accepted) row.id = cityVenueIdForPub(city.id, row);
  const pack = validateDiscoveryPack({ city: city.id, source: "Parallel Task API",
    observationMeaning: "Each row's observedAt is the date its Parallel research result was retrieved. Cached reruns retain that date. Not a claim that every page was fetched live or that the venue is open tonight.",
    populationPriority: city.population, populationSources: POPULATION_SOURCES, venues: assembled.venues }, city);
  if (pack.venues.length || previous.length) await writeJson(discoveryPath(city), pack);
  const report = { city: city.id, districts: new Set(own.map(({ slice }) => slice.district)).size, slices: own.length,
    slicesComplete: own.filter(({ result }) => result.complete).length,
    incompleteSlices: own.filter(({ result }) => !result.complete).map(({ slice }) => `${slice.district}/${slice.category.id}`),
    taskRuns: own.reduce((total, { result }) => total + result.taskRuns, 0),
    researched: own.reduce((total, { result }) => total + result.researched, 0),
    added: assembled.accepted.length, retained: assembled.retained, totalAccepted: pack.venues.length, repeats: assembled.repeats,
    duplicates: assembled.duplicates, withdrawn: assembled.withdrawn, rejected: own.flatMap(({ result }) => result.rejected),
    outputPath: path.relative(ROOT, discoveryPath(city)) };
  await writeJson(path.join(OUT, "reports", `${city.id}.json`), report);
  console.log(`city: ${city.id}\nadded: ${report.added}\nretained: ${report.retained.length}\ntotal: ${report.totalAccepted}\nduplicates: ${report.duplicates.length}\nrejected: ${report.rejected.length}\ntaskRuns: ${report.taskRuns}`);
  return report;
}

async function checkPacks({ publishFreshness = false } = {}) {
  let venues = 0;
  const cities = [];
  const dates = [];
  for (const city of DISCOVERY_CITIES) {
    const pack = await readJson(discoveryPath(city));
    if (!pack) continue;
    validateDiscoveryPack(pack, city);
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
  for (const call of calls) {
    const key = `${call.endpoint.split("?")[0].replace(/\/trun_[^/]+/, "/{run_id}")} ${call.status}`;
    byEndpoint[key] = (byEndpoint[key] ?? 0) + 1;
  }
  return { calls: calls.length, byEndpoint, estimatedCostUsd: Number(calls.reduce((total, call) => total + call.estimatedCostUsd, 0).toFixed(3)) };
}

async function main() {
  if (process.argv.length === 3 && ["-v", "-V", "--version"].includes(process.argv[2])) { console.log("2.0.0"); return; }
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: node scripts/discover_parallel_venues.mjs [--cities=<id,id>] [--matches=<n>] [--concurrency=<n>] [--processor=<base|core|pro|ultra>] [--refresh] [--list] [--check]\ndefaults: every city map, one paged Task slice per postcode district and category, 30 candidates per page, 40 concurrent slices, pro processor, resume cached runs\ncredential: PARALLEL_API_KEY from environment; --check and --list are keyless\nexamples[3]:\n  node scripts/discover_parallel_venues.mjs --list\n  node scripts/discover_parallel_venues.mjs --cities=birmingham,leeds,glasgow\n  node scripts/discover_parallel_venues.mjs --check");
    return;
  }
  if (options.check) { await checkPacks(); return; }
  const targets = DISCOVERY_CITIES.filter((city) => !options.cities || options.cities.includes(city.id));
  if (options.list || process.argv.length === 2) {
    console.log(`cities[${targets.length}]{id,population}:\n${targets.map((city) => `  ${city.id},${city.population}`).join("\n")}\nhelp: node scripts/discover_parallel_venues.mjs --cities=birmingham,leeds,glasgow`);
    return;
  }
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const base = await baseVenues();
  const slices = targets.flatMap((city) => {
    const cityKnown = base.filter((row) => inCity(row.lat, row.lng, city));
    return postcodeDistricts(cityKnown, city).flatMap((district) => {
      const districtKnown = cityKnown.filter((row) => (postcodeIn(row.postcode) ?? postcodeIn(row.address))?.split(" ")[0] === district)
        .map((row) => ({ name: row.name, postcode: postcodeIn(row.postcode) ?? postcodeIn(row.address) }));
      return CATEGORIES.map((category) => ({ city, district, category, districtKnown }));
    });
  });
  console.log(`cities: ${targets.length}\nslices: ${slices.length}`);
  const { results, failures } = await pool(slices, options.concurrency, (slice) => runSlice(slice, options));
  const cities = [];
  for (const city of targets) cities.push(await assembleCity(city, slices, results, base));
  await checkPacks({ publishFreshness: true });
  const usage = await usageSummary();
  const observed = (await Promise.all(targets.map(async (city) => ((await readJson(discoveryPath(city)))?.venues ?? []).map((row) => row.observedAt)))).flat().sort();
  await writeJson(path.join(OUT, "summary.json"), { processor: options.processor, matchesPerPage: options.matches, categories: CATEGORIES.map((category) => category.id),
    oldestObservedAt: observed[0] ?? null, newestObservedAt: observed.at(-1) ?? null,
    cities: cities.map(({ city, districts, slices: count, slicesComplete, taskRuns, researched, added, retained, totalAccepted, duplicates, rejected }) => ({ city, districts, slices: count, slicesComplete, taskRuns, researched, added, retained: retained.length, duplicates: duplicates.length, rejected: rejected.length, totalAccepted })),
    failedSlices: failures.length, firstFailure: failures[0] ?? null, usage });
  console.log(`calls: ${usage.calls}\nestimatedCostUsd: ${usage.estimatedCostUsd.toFixed(3)}\nhelp: npm run build:city-slim && npm run validate-data`);
  if (failures.length) throw new Error(`${failures.length} slices failed; verified rows so far are published, checkpoints retained, rerun to resume. First: ${failures[0]}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.log(`error: ${JSON.stringify(error.message)}`); process.exitCode = 1; });
}
