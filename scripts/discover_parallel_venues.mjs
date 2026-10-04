#!/usr/bin/env node
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HARVEST_SOURCES, isRefusedOnPermission } from "../lib/harvest/sourcePolicy.ts";
import { cityVenueIdForPub } from "../lib/cityVenueId.mjs";
import { DISCOVERY_CITIES, POPULATION_SOURCES } from "./lib/parallelDiscoveryCities.mjs";
import { allowedEvidenceUrl, dedupeVenues, inCity, parseTaskVenues, validateDiscoveryPack } from "./lib/parallelVenueDiscovery.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data-harvest/parallel-venue-discovery");
const OUT = path.join(ROOT, "data/parallel-discovery");
const API = "https://api.parallel.ai";
const PRICES = { base: 0.01, core: 0.025, pro: 0.10, ultra: 0.30 };
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
  const options = { cities: null, cityLimit: Infinity, matches: 100, processor: "pro", list: false, refresh: false, help: false, check: false };
  for (const arg of argv) {
    if (["--list", "--refresh", "--help", "--check"].includes(arg)) options[arg.slice(2)] = true;
    else if (arg.startsWith("--cities=")) options.cities = arg.slice(9).split(",");
    else if (arg.startsWith("--city-limit=")) {
      options.cityLimit = Number(arg.slice(13));
      if (!Number.isFinite(options.cityLimit)) throw new Error("Invalid cityLimit; use a positive integer");
    }
    else if (arg.startsWith("--matches=")) {
      options.matches = Number(arg.slice(10));
      if (!Number.isFinite(options.matches)) throw new Error("Invalid matches; use a positive integer");
    }
    else if (arg.startsWith("--processor=")) options.processor = arg.slice(12);
    else throw new Error(`Unknown argument ${arg}; run node scripts/discover_parallel_venues.mjs --help`);
  }
  for (const key of ["matches", "cityLimit"]) if (options[key] !== Infinity && (!Number.isInteger(options[key]) || options[key] < 1)) throw new Error(`Invalid ${key}; use a positive integer`);
  if (!Object.hasOwn(PRICES, options.processor)) throw new Error("Invalid processor; choose base, core, pro or ultra");
  if (options.cities?.some((id) => !DISCOVERY_CITIES.some((city) => city.id === id))) throw new Error("Unknown city; run node scripts/discover_parallel_venues.mjs --list");
  return options;
}

export function researchExclusions(known) {
  const names = [...new Set(known.map((row) => `${row.name}${row.postcode ? ` (${row.postcode})` : ""}`))];
  const selected = [];
  let characters = 0;
  for (const name of names) {
    characters += name.length + 4;
    if (characters > 14000) break;
    selected.push(name);
  }
  return { knownVenueNames: selected, contextIsPartial: selected.length !== names.length, totalKnownVenues: known.length };
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

async function parallelRequest(endpoint, { city, body, cost = 0 } = {}) {
  if (!process.env.PARALLEL_API_KEY) throw new Error("PARALLEL_API_KEY is missing; load it in the invoking shell");
  if (endpoint === "/v1/tasks/runs") {
    const size = () => JSON.stringify({ input: body.input, task_spec: body.task_spec }).length;
    while (size() > 24000 && body.input.knownVenueNames.length) { body.input.knownVenueNames.pop(); body.input.contextIsPartial = true; }
    while (size() > 24000 && body.input.searchSeeds.length) body.input.searchSeeds.pop();
    if (size() > 24000) throw new Error("Task context exceeds documented input limit; no request sent");
  }
  const startedAt = new Date().toISOString();
  let status = "network-error";
  let usage = null;
  let runId = null;
  try {
    const response = await fetch(`${API}${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: { "x-api-key": process.env.PARALLEL_API_KEY, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000), redirect: "error",
    });
    status = response.status;
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const details = Array.isArray(failure.detail) ? failure.detail.map((item) => ({ path: item.loc, type: item.type })) : [];
      throw new Error(`Parallel ${endpoint.split("?")[0]} HTTP ${status}; validation=${JSON.stringify(details)}; checkpoint retained, rerun to resume`);
    }
    const data = await response.json();
    usage = data.usage ?? null;
    runId = data.run_id ?? data.run?.run_id ?? data.search_id ?? null;
    return data;
  } finally {
    await appendFile(path.join(OUT, "usage.jsonl"), `${JSON.stringify({ startedAt, city, endpoint, status, runId, usage, estimatedCostUsd: status === 200 || status === 201 || status === 202 ? cost : 0 })}\n`);
  }
}

async function existingVenues() {
  const venues = [];
  for (const file of ["uk_osm_pubs.json", "uk_osm_venues_drink.json", "uk_osm_venues_food.json", "uk_osm_venues_work.json"]) {
    const pack = await readJson(path.join(ROOT, "data/osm/uk", file));
    if (!pack) throw new Error(`Missing national dedupe input data/osm/uk/${file}`);
    venues.push(...(pack.pubs ?? pack.venues ?? []));
  }
  for (const entry of await readdir(path.join(ROOT, "data/cities"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pack = await readJson(path.join(ROOT, "data/cities", entry.name, "osm_pubs.json"));
    venues.push(...(pack?.pubs ?? []));
    const discovery = await readJson(path.join(ROOT, "data/cities", entry.name, "parallel_venues.json"));
    venues.push(...(discovery?.venues ?? []));
  }
  const london = await readJson(path.join(ROOT, "public/data/pint_prices_app_dataset.json"));
  venues.push(...london.map((row) => ({ name: row.pub_name, lat: row.latitude, lng: row.longitude, address: row.address })));
  for (const city of DISCOVERY_CITIES.filter((item) => !item.publishable)) {
    const pack = await readJson(path.join(OUT, "cities", `${city.id}.json`));
    venues.push(...(pack?.venues ?? []));
  }
  return venues.filter((row) => row.name && Number.isFinite(row.lat) && Number.isFinite(row.lng));
}

async function geocode(candidate, city) {
  if (candidate.lat !== null && candidate.lng !== null) return candidate;
  const postcode = candidate.postcode;
  const cacheFile = path.join(RAW, "postcodes", `${postcode.replace(/\s/g, "")}.json`);
  let cached = await readJson(cacheFile);
  if (!cached) {
    const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok && response.status !== 404) throw new Error(`Postcode geocoding HTTP ${response.status}`);
    cached = { url, observedAt: new Date().toISOString(), response: await response.json() };
    await writeJson(cacheFile, cached);
  }
  const point = cached.response?.result;
  if (!point || !inCity(point.latitude, point.longitude, city)) return null;
  return { ...candidate, lat: point.latitude, lng: point.longitude, coordinatePrecision: "postcode-centroid", geocode: { url: cached.url, observedAt: cached.observedAt, postcode, quality: point.quality } };
}

async function discoverCity(city, existing, options) {
  const checkpoint = path.join(RAW, `${city.id}.json`);
  let state = options.refresh ? null : await readJson(checkpoint);
  if (!state) {
    state = { city: city.id, searches: [], createdAt: new Date().toISOString() };
    await writeJson(checkpoint, state);
  }
  for (const kind of ["pub", "bar", "restaurant"]) {
    if (state.searches.some((item) => item.kind === kind)) continue;
    const response = await parallelRequest("/v1/search", { city: city.id, cost: 0.005, body: {
      objective: `Discover ${kind}s in ${city.displayName}, United Kingdom, serving alcoholic drinks. Prefer first-party venue websites with full address and postcode. No Google Maps, Google Places or copied Google content.`,
      search_queries: [`${city.displayName} ${kind} drinks address`, `${city.displayName} independent ${kind} postcode`, `${city.displayName} new ${kind} cocktails`],
      mode: "advanced", max_chars_total: 20000, advanced_settings: { source_policy: SOURCE_POLICY },
    } });
    const responsePath = path.join(RAW, `${city.id}-${kind}-search.json`);
    await writeJson(responsePath, response);
    state.searches.push({ kind, searchId: response.search_id, responsePath: path.relative(ROOT, responsePath) });
    await writeJson(checkpoint, state);
  }
  if (!state.runId) {
    const seeds = [];
    for (const search of state.searches) {
      const data = await readJson(path.join(ROOT, search.responsePath));
      seeds.push(...data.results.filter((row) => allowedEvidenceUrl(row.url)).map((row) => ({ url: row.url, title: row.title })));
    }
    const known = existing.filter((row) => inCity(row.lat, row.lng, city));
    const run = await parallelRequest("/v1/tasks/runs", { city: city.id, cost: PRICES[options.processor], body: {
      processor: options.processor, source_policy: SOURCE_POLICY,
      input: {
        objective: `Discover up to ${options.matches} distinct currently operating pubs, bars, and restaurants serving alcoholic drinks in ${city.displayName}, UK, missing from knownVenues. Search the whole city, including neighbourhoods, recently opened venues and independent venues. Use searchSeeds as a starting point, then broaden research. Each row must represent one venue at one address. Use its own site or a reputable venue directory. No Google Maps/Places content, ratings, reviews, hours or prices. Restaurants need explicit beer, wine-list, cocktail or alcoholic drinks evidence. Include complete address and full UK postcode. Set coordinates to null unless a cited page explicitly states them. website must be the venue's own site or null. Evidence must be short verbatim excerpts from cited pages that together state this venue's name, postcode and pub/bar/alcohol service. Do not invent or paraphrase excerpts. Cite each list element in research basis with original excerpts. Keep each excerpt under 240 characters. Never infer an address or serving alcohol. Omit closed venues or unverifiable rows.`,
        city: city.displayName, bbox: city.bbox, ...researchExclusions(known), searchSeeds: seeds,
      }, task_spec: { output_schema: { type: "json", json_schema: SCHEMA } },
    } });
    if (!run.run_id) throw new Error("Parallel Task create response has no run_id");
    state.runId = run.run_id;
    state.processor = options.processor;
    await writeJson(checkpoint, state);
    console.log(`city: ${city.id}\nrun: ${state.runId}\nstate: researching`);
  }
  if (!state.resultPath) {
    for (;;) {
      const status = await parallelRequest(`/v1/tasks/runs/${state.runId}`, { city: city.id });
      if (status.status === "completed") break;
      if (["failed", "cancelled"].includes(status.status)) throw new Error(`Parallel Task ${state.runId} ${status.status}; use --refresh to start another observation`);
      await new Promise((resolve) => setTimeout(resolve, 20_000));
    }
    const response = await parallelRequest(`/v1/tasks/runs/${state.runId}/result?timeout=30`, { city: city.id });
    const resultPath = path.join(RAW, `${city.id}-${state.runId}-result.json`);
    state.observedAt = new Date().toISOString();
    await writeJson(resultPath, response);
    state.resultPath = path.relative(ROOT, resultPath);
    await writeJson(checkpoint, state);
  }
  const result = await readJson(path.join(ROOT, state.resultPath));
  const parsed = parseTaskVenues(result, city, state.observedAt);
  const geocoded = [];
  for (const candidate of parsed.candidates) {
    const row = await geocode(candidate, city);
    if (row) geocoded.push(row);
    else parsed.rejected.push({ name: candidate.name, reason: "postcode-does-not-geocode-inside-city" });
  }
  const { accepted, duplicates } = dedupeVenues(geocoded, existing);
  for (const row of accepted) row.id = city.publishable ? cityVenueIdForPub(city.id, row) : null;
  const outputPath = city.publishable ? path.join(ROOT, "data/cities", city.id, "parallel_venues.json") : path.join(OUT, "cities", `${city.id}.json`);
  const previous = await readJson(outputPath, { venues: [] });
  const pack = validateDiscoveryPack({ city: city.id, source: "Parallel Search and Task API", observedAt: state.observedAt, runId: state.runId,
    observationMeaning: "Date Parallel research was retrieved. Cached reruns retain that date. Not a claim that every page was fetched live or that the venue is open tonight.",
    populationPriority: city.population, populationSources: POPULATION_SOURCES, publishable: city.publishable,
    venues: [...previous.venues, ...dedupeVenues(accepted, previous.venues).accepted] }, city);
  await writeJson(outputPath, pack);
  const report = { city: city.id, runId: state.runId, observedAt: state.observedAt, researched: result.output.content.venues.length, accepted: accepted.length, totalAccepted: pack.venues.length,
    rejected: parsed.rejected, duplicates, publishable: city.publishable, outputPath: path.relative(ROOT, outputPath) };
  await writeJson(path.join(OUT, "reports", `${city.id}.json`), report);
  console.log(`city: ${city.id}\naccepted: ${accepted.length}\ntotal: ${pack.venues.length}\nduplicates: ${duplicates.length}\nrejected: ${parsed.rejected.length}`);
  existing.push(...accepted);
}

async function checkPacks({ publishFreshness = false } = {}) {
  let venues = 0;
  const cities = [];
  const dates = [];
  for (const city of DISCOVERY_CITIES) {
    const file = city.publishable ? path.join(ROOT, "data/cities", city.id, "parallel_venues.json") : path.join(OUT, "cities", `${city.id}.json`);
    const pack = await readJson(file);
    if (!pack) continue;
    validateDiscoveryPack(pack, city);
    dates.push(...pack.venues.map((venue) => venue.observedAt));
    venues += pack.venues.length;
    cities.push({ city: city.id, venues: pack.venues.length, publishable: city.publishable });
  }
  if (!dates.length) throw new Error("No accepted observations to validate or date");
  const oldestObservedAt = dates.reduce((oldest, date) => Date.parse(date) < Date.parse(oldest) ? date : oldest);
  const freshness = { source: "Parallel venue discovery", oldestObservedAt, venues, cities };
  const file = path.join(OUT, "freshness.json");
  if (publishFreshness) await writeJson(file, freshness);
  else if (JSON.stringify(await readJson(file)) !== JSON.stringify(freshness)) throw new Error("Discovery freshness differs from per-row observations; rerun cached discovery to rebuild");
  console.log(`validatedCities: ${cities.length}\nvalidatedVenues: ${venues}\noldestObservedAt: ${oldestObservedAt}`);
}

async function main() {
  if (process.argv.length === 3 && ["-v", "-V", "--version"].includes(process.argv[2])) { console.log("1.0.0"); return; }
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: node scripts/discover_parallel_venues.mjs [--cities=<id,id>] [--city-limit=<n>] [--matches=<n>] [--processor=<base|core|pro|ultra>] [--refresh] [--list] [--check]\ndefaults: all 32 cities, 100 candidates per city, pro processor, resume cached runs\ncredential: PARALLEL_API_KEY from environment; --check and --list are keyless\nexamples[3]:\n  node scripts/discover_parallel_venues.mjs --list\n  node scripts/discover_parallel_venues.mjs --cities=birmingham,leeds,glasgow\n  node scripts/discover_parallel_venues.mjs --check");
    return;
  }
  if (options.check) { await checkPacks(); return; }
  const targets = DISCOVERY_CITIES.filter((city) => !options.cities || options.cities.includes(city.id)).slice(0, options.cityLimit);
  if (options.list || process.argv.length === 2) {
    console.log(`cities[${targets.length}]{id,population,publishable}:\n${targets.map((city) => `  ${city.id},${city.population},${city.publishable}`).join("\n")}\nhelp: node scripts/discover_parallel_venues.mjs --cities=birmingham,leeds,glasgow`);
    return;
  }
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const existing = await existingVenues();
  for (const city of targets) await discoverCity(city, existing, options);
  await checkPacks({ publishFreshness: true });
  const calls = (await readFile(path.join(OUT, "usage.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  console.log(`calls: ${calls.length}\nestimatedCostUsd: ${calls.reduce((total, call) => total + call.estimatedCostUsd, 0).toFixed(3)}\nhelp: npm run build:city-slim && npm run validate-data`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.log(`error: ${JSON.stringify(error.message)}`); process.exitCode = 1; });
}
