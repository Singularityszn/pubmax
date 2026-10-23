#!/usr/bin/env node
// London restaurants that serve drinks, on the evidence of their own websites.
//
// OSM supplies the restaurant (name, address, position). The restaurant's own
// site supplies the evidence: the OSM `website` tag where one names an own
// site, otherwise a Tavily Search result whose host carries the restaurant's
// name and whose text states its postcode or street address. Each site page is
// read through Tavily Extract only after robots.txt permits it, and one quote
// that states alcohol, the URL that stated it and the day it was read are kept.
// A page that says bring-your-own or no alcohol settles the restaurant as dry.
//
// Run:
//   node scripts/harvest_london_restaurant_drinks.mjs                 # spend, resume caches
//   node scripts/harvest_london_restaurant_drinks.mjs --search-limit=0 # tagged sites only
//   node scripts/harvest_london_restaurant_drinks.mjs --replay          # no network, rebuild from caches, refuse if one is missing
//   node scripts/harvest_london_restaurant_drinks.mjs --check           # validate the committed pack
//
// TAVILY_API_KEY comes from the environment. The script never reads a key file.
// OSM data is © OpenStreetMap contributors, ODbL 1.0.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRobotsChecker } from "../lib/harvest/robots.ts";
import { harvestRedirectLanding } from "../lib/harvest/sourcePolicy.ts";
import { GREATER_LONDON_BBOX } from "./fetch_uk_osm_venues.mjs";
import { inGreaterLondon } from "./build_london_venue_shards.mjs";
import {
  drinkLinks,
  drinksEvidence,
  excludedOsmIds,
  hostOf,
  LONDON,
  offPremisesUrl,
  pairExtractResults,
  restaurantCandidate,
  retryableUnreadable,
  searchBindsSite,
  searchQuery,
  validateRestaurantDrinksPack,
} from "./lib/londonRestaurantDrinks.mjs";
import { allowedEvidenceUrl, ownSiteFor } from "./lib/parallelVenueDiscovery.mjs";
import { fetchOverpass } from "./lib/overpassClient.mjs";
import { statesAlcohol } from "./lib/ukOsmVenueSeed.mjs";
import { createRobotsGate } from "./lib/webSlice.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data-harvest", "london-restaurant-drinks");
const OUT = path.join(ROOT, "data", "london_restaurant_drinks");
const EVIDENCE_PATH = path.join(OUT, "evidence.json");
const EXCLUSIONS_PATH = path.join(OUT, "exclusions.json");
const TAVILY = "https://api.tavily.com";
const TAVILY_CREDIT_USD = 0.008;
const CHARING_CROSS = { lat: 51.5073, lng: -0.1276 };

function parseArgs(argv) {
  const options = { replay: false, check: false, refreshOsm: false, searchLimit: Infinity, help: false };
  for (const arg of argv) {
    if (arg === "--replay") options.replay = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--refresh-osm") options.refreshOsm = true;
    else if (arg === "--help") options.help = true;
    else if (arg.startsWith("--search-limit=")) options.searchLimit = Number(arg.slice(15));
    else throw new Error(`Unknown argument ${arg}; run with --help`);
  }
  if (!(options.searchLimit >= 0)) throw new Error("--search-limit takes a number of restaurants, 0 or more");
  return options;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, value, pretty = false) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
  await rename(temp, file);
}

const hashed = (dir, key) => path.join(RAW, dir, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);

function limiter(size) {
  let active = 0;
  const waiting = [];
  return async (task) => {
    while (active >= size) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

async function osmRestaurants({ refresh, spend, excluded }) {
  const file = path.join(RAW, "overpass.json");
  let raw = refresh ? null : await readJson(file);
  if (!raw) {
    if (!spend) throw new Error(`--replay reads ${path.relative(ROOT, file)} and it is missing; run without --replay to fetch it`);
    const [south, west, north, east] = GREATER_LONDON_BBOX;
    raw = await fetchOverpass(`[out:json][timeout:180];\n(nwr["amenity"="restaurant"](${south},${west},${north},${east}););\nout center tags;`, { allowStale: true });
    await writeJson(file, raw);
  }
  const candidates = [];
  const seen = new Set();
  for (const element of raw.elements ?? []) {
    const candidate = restaurantCandidate(element, { statesAlcohol, excluded });
    if (!candidate || seen.has(candidate.osmId) || !inGreaterLondon(candidate.lat, candidate.lng)) continue;
    seen.add(candidate.osmId);
    candidates.push(candidate);
  }
  return { candidates, osmBase: raw.osm3s?.timestamp_osm_base ?? null, elements: raw.elements?.length ?? 0 };
}

function tavilyClient(spend) {
  const key = process.env.TAVILY_API_KEY;
  if (spend && !key) throw new Error("TAVILY_API_KEY is not set. Load it in the invoking shell, or run --replay.");
  const slot = limiter(2);
  const usage = { searches: 0, extracts: 0, credits: 0, failures: 0 };
  async function call(endpoint, body) {
    return slot(async () => {
      for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(`${TAVILY}${endpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ ...body, include_usage: true }),
          signal: AbortSignal.timeout(120_000),
        }).catch((error) => ({ ok: false, status: 0, error }));
        if (response.ok) {
          const data = await response.json();
          usage.credits += Number(data.usage?.credits ?? 0);
          return data;
        }
        usage.failures += 1;
        if ([402, 432, 433].includes(response.status)) throw new Error(`Tavily refused ${endpoint} with HTTP ${response.status}: the account is out of credit`);
        if (attempt >= 7) throw Object.assign(new Error(`Tavily ${endpoint} failed after 8 attempts (last HTTP ${response.status})`), { transient: true });
        // A 429 says when to come back; otherwise back off, at most a minute.
        const retryAfter = Number(response.headers?.get?.("retry-after"));
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : Math.min(60_000, 5_000 * 2 ** attempt)));
      }
    });
  }
  return {
    usage,
    async search(query) {
      const file = hashed("searches", query);
      const cached = await readJson(file);
      if (cached || !spend) return cached;
      usage.searches += 1;
      let data;
      try {
        data = await call("/search", { query, search_depth: "basic", max_results: 8, include_raw_content: "text", country: "united kingdom" });
      } catch (error) {
        // A rate limit that outlasts the retries leaves this restaurant pending for the next run.
        if (error.transient) return null;
        throw error;
      }
      const stored = { query, observedAt: new Date().toISOString(), results: data.results ?? [] };
      await writeJson(file, stored);
      return stored;
    },
    // Reads up to 20 pages a call; each page is cached on its own, failures included.
    async extract(urls) {
      const pages = new Map();
      const missing = [];
      for (const url of urls) {
        const cached = await readJson(hashed("pages", url));
        // A read that failed for a reason other than a gone page is asked again
        // by a paid run; a replay keeps what was recorded.
        if (cached && !(spend && retryableUnreadable(cached))) pages.set(url, cached);
        else missing.push(url);
      }
      if (!spend) return pages;
      const batches = [];
      for (let at = 0; at < missing.length; at += 20) batches.push(missing.slice(at, at + 20));
      await Promise.all(batches.map(async (batch) => {
        usage.extracts += 1;
        let data;
        try {
          data = await call("/extract", { urls: batch, extract_depth: "basic", format: "markdown", timeout: 30 });
        } catch (error) {
          if (error.transient) return;
          throw error;
        }
        const observedAt = new Date().toISOString();
        for (const [url, answer] of pairExtractResults(batch, data)) {
          // A failure that does not say the page is gone stays unread, so the
          // restaurant ends pending and the next run asks again.
          if (answer.retry) continue;
          const page = { url, observedAt, ...answer };
          await writeJson(hashed("pages", url), page);
          pages.set(url, page);
        }
      }));
      return pages;
    },
  };
}

function robotsAsker(spend) {
  const gate = createRobotsGate(() => createRobotsChecker());
  const slot = limiter(16);
  return (url) => slot(async () => {
    const file = hashed("robots", url);
    const cached = await readJson(file);
    if (cached?.url === url || !spend) return cached;
    const answer = { url, ...(await gate(url)), checkedAt: new Date().toISOString() };
    await writeJson(file, answer);
    return answer;
  });
}

// The landed page still belongs to the restaurant: the same host, or a host
// that carries the restaurant's name, and inside the source fence.
function landedOnOwnSite(candidate, site, page) {
  const landed = harvestRedirectLanding(page.url, page.landedUrl);
  if (landed.outcome === "refused" || !allowedEvidenceUrl(landed.url)) return null;
  if (hostOf(landed.url) === hostOf(site)) return landed.url;
  return ownSiteFor(candidate.name, landed.url, LONDON) ? landed.url : null;
}

const nearestCentreFirst = (a, b) => distanceKm(CHARING_CROSS, a) - distanceKm(CHARING_CROSS, b) || a.osmId.localeCompare(b.osmId);

// Sites: the OSM tag first, then search for the rest, nearest the centre first.
async function resolveSites(candidates, searchLimit, tavily, counts) {
  const sites = new Map();
  const untagged = [];
  for (const candidate of candidates) {
    if (candidate.website) {
      sites.set(candidate.osmId, { url: candidate.website, from: "osm-website" });
      counts.siteFromOsm += 1;
    } else untagged.push(candidate);
  }
  const toSearch = untagged.sort(nearestCentreFirst).slice(0, Number.isFinite(searchLimit) ? searchLimit : untagged.length);
  counts.notSearched = untagged.length - toSearch.length;
  await Promise.all(toSearch.map(async (candidate) => {
    const search = await tavily.search(searchQuery(candidate));
    if (!search) {
      counts.pending += 1;
      return;
    }
    counts.searched += 1;
    const url = (search.results ?? []).map((result) => searchBindsSite(candidate, result)).find(Boolean);
    if (url) {
      sites.set(candidate.osmId, { url, from: "tavily-search" });
      counts.siteFromSearch += 1;
    } else counts.noSite += 1;
  }));
  return sites;
}

// One URL of one restaurant's site, judged. Returns the links worth a second read.
function judgePage(entry, candidate, url, answer, page) {
  if (!answer) return void (entry.pending = true);
  if (answer.outcome !== "allowed") return void (entry.blocked = answer.outcome === "skipped" ? "robotsSkipped" : "robotsRefused");
  if (!page) return void (entry.pending = true);
  if (page.unreadable) return void (entry.blocked = "unreadable");
  const landed = landedOnOwnSite(candidate, entry.site.url, page);
  if (!landed) return void (entry.blocked = "landedOffSite");
  entry.read = true;
  const found = offPremisesUrl(landed) ? {} : drinksEvidence(page.text, candidate.name);
  // A refusal on any page read outranks a drinking line read beside it.
  if (found.refused) entry.verdict = { refused: found.refused, url: landed };
  else if (found.quote && !entry.verdict) {
    entry.verdict = { quote: found.quote, url: landed, observedAt: page.observedAt, robots: { outcome: answer.outcome, checkedAt: answer.checkedAt }, website: `${new URL(landed).origin}/` };
  }
  return entry.verdict ? [] : drinkLinks(page.text, landed);
}

// Reads: the site page, then drinks and menu pages when it states nothing.
async function readSites(sites, byId, tavily, robots) {
  const state = new Map();
  for (const [osmId, site] of sites) state.set(osmId, { site, urls: [site.url], verdict: null });
  for (let round = 0; round < 2; round += 1) {
    const ask = [...new Set([...state.values()].filter((entry) => !entry.verdict).flatMap((entry) => entry.urls))];
    const answers = new Map(await Promise.all(ask.map(async (url) => [url, await robots(url)])));
    const pages = await tavily.extract(ask.filter((url) => answers.get(url)?.outcome === "allowed"));
    for (const [osmId, entry] of state) {
      if (entry.verdict) continue;
      const next = [];
      for (const url of entry.urls) {
        next.push(...(judgePage(entry, byId.get(osmId), url, answers.get(url), pages.get(url)) ?? []));
        if (entry.verdict?.refused) break;
      }
      entry.urls = round === 0 && !entry.verdict ? [...new Set(next)] : [];
    }
  }
  return state;
}

function publishedRows(state, byId, counts) {
  const rows = [];
  for (const [osmId, entry] of state) {
    const candidate = byId.get(osmId);
    const verdict = entry.verdict;
    if (verdict?.refused) counts.refusesAlcohol += 1;
    else if (verdict?.quote) {
      counts.accepted += 1;
      rows.push({
        osmId,
        kind: "restaurant",
        name: candidate.name,
        address: candidate.address,
        lat: candidate.lat,
        lng: candidate.lng,
        website: verdict.website,
        siteFrom: entry.site.from,
        evidence: [{ url: verdict.url, excerpt: verdict.quote, observedAt: verdict.observedAt, robots: verdict.robots }],
      });
    } else if (entry.pending) counts.pending += 1;
    else if (entry.read) counts.noEvidence += 1;
    else counts[entry.blocked ?? "noEvidence"] += 1;
  }
  return rows.sort((a, b) => a.osmId.localeCompare(b.osmId, "en", { numeric: true }));
}

async function writeOutputs({ rows, osmBase, counts, searchLimit, usage, exclusions }) {
  const pack = {
    meaning: "London restaurants OpenStreetMap does not tag with alcohol, whose own website states that they serve it. Identity (name, address, position) is OSM's; each row's evidence is one verbatim line from the restaurant's own site, the URL that stated it, the time it was read and the robots answer that permitted the read. observedAt dates the read, not tonight's menu.",
    osmBase,
    license: "ODbL (identity) - © OpenStreetMap contributors",
    rows,
  };
  const problems = validateRestaurantDrinksPack(pack, { inGreaterLondon, exclusions });
  if (problems.length) throw new Error(`refusing to write a pack that fails its own check:\n${problems.slice(0, 20).join("\n")}`);
  await writeJson(EVIDENCE_PATH, pack, true);
  const previous = await readJson(path.join(OUT, "report.json"));
  const spent = { searches: usage.searches, extractCalls: usage.extracts, credits: usage.credits, approxUsd: Number((usage.credits * TAVILY_CREDIT_USD).toFixed(2)) };
  const totals = previous?.tavilyTotals ?? { searches: 0, extractCalls: 0, credits: 0 };
  await writeJson(path.join(OUT, "report.json"), {
    meaning: "Counts from the last run of scripts/harvest_london_restaurant_drinks.mjs. Restaurants in exclusions.json are never candidates. Every candidate has a site (siteFromOsm, siteFromSearch) or not (noSite, notSearched, pending); every site lands in one of robotsRefused, robotsSkipped, unreadable, landedOffSite, refusesAlcohol, noEvidence, pending or accepted. tavilyTotals accumulates every run's spend; account invoices remain authoritative.",
    searchLimit: Number.isFinite(searchLimit) ? searchLimit : null,
    counts,
    lastRunTavily: spent,
    tavilyTotals: { searches: totals.searches + spent.searches, extractCalls: totals.extractCalls + spent.extractCalls, credits: totals.credits + spent.credits },
  }, true);
  return spent;
}

async function check() {
  const pack = await readJson(EVIDENCE_PATH);
  const problems = validateRestaurantDrinksPack(pack, { inGreaterLondon, exclusions: await readJson(EXCLUSIONS_PATH) });
  if (problems.length) throw new Error(`${problems.length} problem(s) in ${path.relative(ROOT, EVIDENCE_PATH)}:\n${problems.slice(0, 20).join("\n")}`);
  console.log(`ok: ${pack.rows.length} restaurants, each with own-site evidence and recorded robots permission`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: node scripts/harvest_london_restaurant_drinks.mjs [--search-limit=<n>] [--refresh-osm] [--replay] [--check]");
    return;
  }
  if (options.check) return check();

  const spend = !options.replay;
  const tavily = tavilyClient(spend);
  const exclusions = await readJson(EXCLUSIONS_PATH);
  const osm = await osmRestaurants({ refresh: options.refreshOsm && spend, spend, excluded: excludedOsmIds(exclusions) });
  const { candidates } = osm;
  const counts = { osmRestaurants: osm.elements, candidates: candidates.length, siteFromOsm: 0, searched: 0, siteFromSearch: 0, noSite: 0, notSearched: 0,
    robotsRefused: 0, robotsSkipped: 0, unreadable: 0, landedOffSite: 0, refusesAlcohol: 0, noEvidence: 0, pending: 0, accepted: 0 };

  const sites = await resolveSites(candidates, options.searchLimit, tavily, counts);
  const byId = new Map(candidates.map((candidate) => [candidate.osmId, candidate]));
  const state = await readSites(sites, byId, tavily, robotsAsker(spend));
  const rows = publishedRows(state, byId, counts);
  // A replay answers only from the caches; one that leaves a restaurant
  // pending is missing some of them and must not replace the committed pack.
  if (counts.pending && !spend) {
    throw new Error(`--replay left ${counts.pending} restaurant(s) pending: their cached search, robots answer or page read is missing (or --search-limit differs from the run that cached them). Nothing was written.`);
  }
  if (counts.pending) console.warn(`${counts.pending} restaurant(s) still pending a read; rerun to resume.`);
  const spent = await writeOutputs({ rows, osmBase: osm.osmBase, counts, searchLimit: options.searchLimit, usage: tavily.usage, exclusions });
  console.log(JSON.stringify({ counts, lastRunTavily: spent }, null, 2));
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
