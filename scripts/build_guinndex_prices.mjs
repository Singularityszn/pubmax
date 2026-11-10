#!/usr/bin/env node
// Guinness prices from the Guinndex UK, matched to PubMaxx pubs.
//
//   npm run build:guinndex-prices -- --collect     read the site, then build
//   npm run build:guinndex-prices                  build from the cache only
//   npm run build:guinndex-prices -- --collect --county "Greater London"
//
// THE REGISTRY IS THE PERMISSION. Every URL comes from `openDataSourceUrl`
// with the `guinndex-uk` row (lib/harvest/sourceRegistry.ts), so robots.txt's
// `/spoons` rules bind in code and no URL here names a host. The row's delay
// sets the pace, one session, redirects refused. A 403, a 429 or a page that
// is not JSON stops the run without replacing the price pack. Earlier cache
// writes remain. A pub page is read only when the county list already places
// the pub at one PubMaxx venue.
//
// FACTS ONLY. The cache keeps price evidence and matching keys for rebuilding
// in data-harvest/guinndex, which is never committed. The committed file,
// data/uk_prices/guinndex.json, holds the price, the day, the drink, the
// measure, the Guinndex page and the PubMaxx venue it matched. Guinndex's
// names, addresses and points stay in the cache. Other fields are discarded.
//
// A missing or empty county/pub cache fails before output is written. A
// rebuild with no publishable rows also fails and leaves the price pack intact.
//
// A PRICE THE PAGE DOES NOT DATE IS SKIPPED (lib/harvest/guinndex.ts). A pub
// that matches no PubMaxx pub, or matches two, is counted and left out.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  GUINNDEX_DRINK_LABEL,
  GUINNDEX_SERVING,
  GUINNDEX_SKIP_REASONS,
  GUINNDEX_SOURCE_ID,
  readGuinndexObservation,
} from "@/lib/harvest/guinndex";
import { harvestSource, openDataSourceUrl } from "@/lib/harvest/sourcePolicy";
import { CONTACT_EMAIL } from "../lib/siteContact.mjs";
import {
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
  postcodeOutward,
} from "./lib/venueCanonicalization.mjs";

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, "data/uk_prices/guinndex.json");
const UK_BASE_MANIFEST = path.join(ROOT, "public/data/uk_base/manifest.json");
const LONDON_SLIM = path.join(ROOT, "public/data/venues_slim.json");

const GUINNDEX_USER_AGENT = `PUBMAXX/1 (+https://pubmaxxing.com; contact ${CONTACT_EMAIL})`;

/** A pub under exactly the same name may sit this far from its listed point. */
const SAME_NAME_MATCH_METERS = 150;
/** A near-name match is weaker evidence, so it must sit closer. */
const NEAR_NAME_MATCH_METERS = 75;
/** A second candidate this close to the best one makes the match ambiguous. */
const AMBIGUOUS_MARGIN_METERS = 25;

const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const read = (file) => JSON.parse(readFileSync(file, "utf8"));

// "The King's Ford" and "The Kings Ford" are one name, so the apostrophe goes
// before the shared normaliser splits on it.
const identityName = (name) => normalizeVenueIdentityName(String(name ?? "").replace(/['‘’`]/g, ""));
const nearIdentityName = (name) => identityName(String(name ?? "").split(",")[0]);

class StopRun extends Error {}

// --- reading the site --------------------------------------------------------

function createSession(gapMs) {
  let last = 0;
  let requests = 0;
  return {
    get requests() {
      return requests;
    },
    async get(pathAndQuery, { json = true } = {}) {
      const url = openDataSourceUrl(GUINNDEX_SOURCE_ID, pathAndQuery);
      const wait = last + gapMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      last = Date.now();
      requests += 1;
      const response = await fetch(url.href, {
        redirect: "error",
        headers: { "user-agent": GUINNDEX_USER_AGENT, accept: json ? "application/json" : "*/*" },
      });
      if (response.status === 403 || response.status === 429) {
        const limits = ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]
          .map((name) => [name, response.headers.get(name)])
          .filter(([, value]) => value !== null)
          .map(([name, value]) => `${name}=${value}`)
          .join(" ");
        throw new StopRun(`HTTP ${response.status} on ${url.pathname} after ${requests} request(s)${limits ? ` (${limits})` : ""}: stopping`);
      }
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status} on ${url.pathname}`);
      const type = response.headers.get("content-type") ?? "";
      if (json && !type.includes("application/json")) {
        throw new StopRun(`${url.pathname} answered ${type || "no content type"}, not JSON: a challenge page stops the run`);
      }
      return json ? response.json() : response.text();
    },
  };
}

/** The county names the county sitemap lists, as the county API spells them. */
function countyNamesFromSitemap(xml) {
  const names = new Set();
  for (const match of String(xml).matchAll(/<loc>https:\/\/guinndex\.co\.uk\/([a-z0-9-]+)<\/loc>/g)) {
    names.add(
      match[1]
        .split("-")
        .map((word) => (word === "and" || word === "of" || word === "upon" ? word : word[0].toUpperCase() + word.slice(1)))
        .join(" "),
    );
  }
  return [...names].sort();
}

const cacheFile = (dir, kind, key) => path.join(dir, kind, `${encodeURIComponent(key)}.json`);

function readCache(dir, kind, key) {
  const file = cacheFile(dir, kind, key);
  return existsSync(file) ? read(file) : undefined;
}

function pickFacts(value, keys) {
  return Object.fromEntries(keys.flatMap((key) => {
    const fact = value?.[key];
    return fact === null || ["string", "number", "boolean"].includes(typeof fact) ? [[key, fact]] : [];
  }));
}

export function writeGuinndexCache(dir, kind, key, value) {
  const pubFacts = (pub) => pickFacts(pub, [
    "slug", "name", "lat", "lng", "formatted_address", "guinness_price_cents",
    "currency", "business_status", "price_source", "call_completed_at",
  ]);
  const facts = kind === "county" ? {
    pubs: (Array.isArray(value?.pubs) ? value.pubs : []).map(pubFacts),
  } : {
    pub: value?.pub ? pubFacts(value.pub) : null,
    drink_prices: (Array.isArray(value?.drink_prices) ? value.drink_prices : [])
      .filter((row) => typeof row?.drink_brand === "string" && /^guinness$/i.test(row.drink_brand.trim()))
      .map((row) => pickFacts(row, ["drink_brand", "drink_type", "measure", "price_cents", "created_at"])),
    price_history: (Array.isArray(value?.price_history) ? value.price_history : []).map((row) => ({
      ...pickFacts(row, ["new_price_cents", "created_at"]),
      flag_reason: typeof row?.flag_reason === "string" && row.flag_reason.trim() ? "flagged" : null,
    })),
  };
  const file = cacheFile(dir, kind, key);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(facts)}\n`);
}

async function collect({ cacheDir, counties: only, gapMs, grid, log }) {
  const session = createSession(gapMs);
  const sitemap = await session.get("/sitemaps/counties.xml", { json: false });
  let counties = countyNamesFromSitemap(sitemap ?? "");
  if (only.length > 0) counties = counties.filter((name) => only.includes(name));
  const report = { counties: counties.length, emptyCounties: [], pubsListed: 0, pubsPriced: 0, detailsRead: 0, detailsMissing: 0 };
  for (const county of counties) {
    let list = readCache(cacheDir, "county", county);
    if (list === undefined) {
      list = await session.get(`/api/county/${encodeURIComponent(county)}?sort=cheapest&page=1&limit=30`);
      writeGuinndexCache(cacheDir, "county", county, list);
    }
    const pubs = Array.isArray(list?.pubs) ? list.pubs : [];
    if (pubs.length === 0) report.emptyCounties.push(county);
    report.pubsListed += pubs.length;
    const priced = pubs.filter((pub) => Number.isInteger(pub?.guinness_price_cents) && pub.guinness_price_cents > 0);
    report.pubsPriced += priced.length;
    log(`${county}: ${pubs.length} pubs, ${priced.length} priced (${session.requests} requests so far)`);
    for (const pub of priced) {
      if (typeof pub.slug !== "string" || !/^[a-z0-9-]+$/.test(pub.slug)) continue;
      if (!matchGuinndexPub(pub, grid).ok) continue;
      if (readCache(cacheDir, "pub", pub.slug) !== undefined) continue;
      const detail = await session.get(`/api/pub/${pub.slug}`);
      if (detail === null) {
        report.detailsMissing += 1;
        continue;
      }
      writeGuinndexCache(cacheDir, "pub", pub.slug, detail);
      report.detailsRead += 1;
    }
  }
  report.requests = session.requests;
  return report;
}

// --- matching to PubMaxx venues ---------------------------------------------

const CELL = 0.003;
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

/**
 * Every pin a Guinndex pub may match: each base-layer pub under the venue that
 * serves it, and each curated London venue no base pub hands to.
 */
export function venueCandidates({ baseRows, slimRows }) {
  const candidates = [];
  const owned = new Set();
  for (const row of baseRows) {
    const [ref, name, address, lat, lng, curatedVenueId] = row;
    if (typeof ref !== "string" || !name) continue;
    if (curatedVenueId) owned.add(curatedVenueId);
    candidates.push({ venueId: curatedVenueId || `venue-uk-${ref}`, name, address: address ?? "", lat, lng });
  }
  for (const row of slimRows) {
    if (owned.has(row.id) || !row.name) continue;
    candidates.push({ venueId: row.id, name: row.name, address: row.filterHints?.searchText ?? "", lat: row.lat, lng: row.lng });
  }
  return candidates;
}

export function indexCandidates(candidates) {
  const grid = new Map();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) continue;
    const norm = identityName(candidate.name);
    if (!norm) continue;
    const key = cellKey(candidate.lat, candidate.lng);
    const entry = { ...candidate, norm, nearNorm: nearIdentityName(candidate.name), outward: postcodeOutward(candidate.address) };
    const bucket = grid.get(key);
    if (bucket) bucket.push(entry);
    else grid.set(key, [entry]);
  }
  return grid;
}

/**
 * The one PubMaxx venue a Guinndex pub is, or why it is none.
 *
 * A SHARED NAME IS NOT A MATCH. The venue must sit close to the point Guinndex
 * gives, its name must be the same pub's name, a postcode district both state
 * must agree, and no second venue may fit nearly as well.
 */
export function matchGuinndexPub(pub, grid) {
  const lat = Number(pub?.lat);
  const lng = Number(pub?.lng);
  const norm = identityName(pub?.name);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !norm) return { ok: false, reason: "no-identity" };
  const nearNorm = nearIdentityName(pub?.name);
  const outward = postcodeOutward(pub?.formatted_address);
  const baseLat = Math.floor(lat / CELL);
  const baseLng = Math.floor(lng / CELL);
  const fits = [];
  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLng = -1; dLng <= 1; dLng += 1) {
      for (const candidate of grid.get(`${baseLat + dLat}:${baseLng + dLng}`) ?? []) {
        const metres = haversineMeters(lat, lng, candidate.lat, candidate.lng);
        const same = candidate.norm === norm;
        if (metres > (same ? SAME_NAME_MATCH_METERS : NEAR_NAME_MATCH_METERS)) continue;
        if (!same && (!namesLikelySamePub(norm, candidate.norm) || !namesLikelySamePub(nearNorm, candidate.nearNorm))) continue;
        if (outward && candidate.outward && outward !== candidate.outward) continue;
        fits.push({ candidate, metres, same });
      }
    }
  }
  if (fits.length === 0) return { ok: false, reason: "no-venue" };
  // An exact name beats a near name, then the nearer pin wins.
  fits.sort((a, b) => Number(b.same) - Number(a.same) || a.metres - b.metres);
  const best = fits[0];
  const rival = fits.find(
    (fit) => fit.candidate.venueId !== best.candidate.venueId && fit.same === best.same && fit.metres <= best.metres + AMBIGUOUS_MARGIN_METERS,
  );
  if (rival) return { ok: false, reason: "ambiguous" };
  return { ok: true, venueId: best.candidate.venueId, venueName: best.candidate.name, metres: Math.round(best.metres) };
}

function baseRowsFromShards() {
  if (!existsSync(UK_BASE_MANIFEST)) return [];
  const manifest = read(UK_BASE_MANIFEST);
  const rows = [];
  for (const shard of manifest.shards ?? []) {
    const file = path.join(ROOT, "public", manifest.urlPrefix, `${shard.id}.json`);
    if (existsSync(file)) rows.push(...(read(file).pubs ?? []));
  }
  return rows;
}

// --- building the committed file ---------------------------------------------

/** Every cached county list and pub page, turned into matched rows and counts. */
function buildRows({ countyLists, pubDetails, grid, now = Date.now() }) {
  const skipped = Object.fromEntries(GUINNDEX_SKIP_REASONS.map((reason) => [reason, 0]));
  const unmatched = { "no-identity": 0, "no-venue": 0, ambiguous: 0 };
  const unmatchedPubs = [];
  const counts = { priced: 0, matched: 0, notRead: 0, published: 0, london: { priced: 0, matched: 0, notRead: 0, published: 0 } };
  const rows = [];
  const seen = new Set();
  for (const [county, list] of countyLists) {
    const london = county === "Greater London";
    for (const listed of Array.isArray(list?.pubs) ? list.pubs : []) {
      if (!Number.isInteger(listed?.guinness_price_cents) || listed.guinness_price_cents <= 0) continue;
      if (seen.has(listed.slug)) continue;
      seen.add(listed.slug);
      counts.priced += 1;
      if (london) counts.london.priced += 1;
      const match = matchGuinndexPub(listed, grid);
      if (!match.ok) {
        unmatched[match.reason] += 1;
        unmatchedPubs.push({ slug: listed.slug, name: listed.name, county, reason: match.reason });
        continue;
      }
      counts.matched += 1;
      if (london) counts.london.matched += 1;
      const detail = pubDetails.get(listed.slug);
      if (!detail) {
        counts.notRead += 1;
        if (london) counts.london.notRead += 1;
        continue;
      }
      const read = readGuinndexObservation(detail, now);
      if (!read.ok) {
        skipped[read.reason] += 1;
        continue;
      }
      counts.published += 1;
      if (london) counts.london.published += 1;
      rows.push({
        venueId: match.venueId,
        venueName: match.venueName,
        london,
        sourceUrl: openDataSourceUrl(GUINNDEX_SOURCE_ID, `/pub/${read.observation.slug}`).href,
        priceGbp: read.observation.priceGbp,
        observedAt: read.observation.observedAt,
        drinkLabel: GUINNDEX_DRINK_LABEL,
        servingSize: GUINNDEX_SERVING,
        priceSource: read.observation.priceSource,
      });
    }
  }
  rows.sort((a, b) => a.venueId.localeCompare(b.venueId) || a.sourceUrl.localeCompare(b.sourceUrl));
  return { rows, counts, skipped, unmatched, unmatchedPubs };
}

function cachedCountyLists(cacheDir) {
  const dir = path.join(cacheDir, "county");
  if (!existsSync(dir)) return [];
  return readdirJson(dir).map(([key, value]) => [decodeURIComponent(key), value]);
}

function cachedPubDetails(cacheDir) {
  const dir = path.join(cacheDir, "pub");
  if (!existsSync(dir)) return new Map();
  return new Map(readdirJson(dir).map(([key, value]) => [decodeURIComponent(key), value]));
}

function readdirJson(dir) {
  return readdirSync(dir)
    .sort()
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -".json".length), read(path.join(dir, name))]);
}

async function main() {
  const cacheDir = path.join(ROOT, "data-harvest/guinndex");
  const counties = process.argv.flatMap((arg, i) => (arg === "--county" ? [process.argv[i + 1]] : []));
  const source = harvestSource(GUINNDEX_SOURCE_ID);
  const gapMs = source.crawlDelaySeconds * 1000;
  const log = (line) => process.stderr.write(`${line}\n`);

  const slim = existsSync(LONDON_SLIM) ? read(LONDON_SLIM) : { rows: [] };
  const grid = indexCandidates(
    venueCandidates({ baseRows: baseRowsFromShards(), slimRows: Array.isArray(slim.rows) ? slim.rows : [] }),
  );

  let collectReport = null;
  if (process.argv.includes("--collect")) {
    try {
      collectReport = await collect({ cacheDir, counties, gapMs, grid, log });
    } catch (error) {
      if (error instanceof StopRun) {
        log(`guinndex: ${error.message}. The price pack was not replaced. Earlier cache entries remain.`);
        process.exitCode = 2;
        return;
      }
      throw error;
    }
  }

  const countyLists = cachedCountyLists(cacheDir);
  const pubDetails = cachedPubDetails(cacheDir);
  if (countyLists.length === 0 || pubDetails.size === 0) {
    throw new Error("guinndex: cache requires county lists and pub pages. Run with --collect before rebuilding. No output was written.");
  }
  const built = buildRows({ countyLists, pubDetails, grid });
  if (built.rows.length === 0) {
    throw new Error("guinndex: cache produced no publishable prices. Refusing to overwrite the price pack. No output was written.");
  }
  const pack = {
    source: "Guinndex UK, guinndex.co.uk",
    sourceId: GUINNDEX_SOURCE_ID,
    readAt: new Date().toISOString(),
    counts: { ...built.counts, skipped: built.skipped, unmatched: built.unmatched },
    rows: built.rows,
  };
  if (collectReport) log(`collect: ${JSON.stringify(collectReport)}`);
  log(`guinndex: ${JSON.stringify(pack.counts)}`);
  writeFileSync(path.join(cacheDir, "unmatched.json"), `${JSON.stringify(built.unmatchedPubs, null, 2)}\n`);
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(pack, null, 2)}\n`);
  log(`wrote ${path.relative(ROOT, OUT_FILE)}: ${built.rows.length} row(s)`);
}

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
