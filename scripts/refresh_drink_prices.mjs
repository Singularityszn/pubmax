// Scheduled permissible-source DRINK price refresh (E2 of docs/PRD_ALL_DRINKS.md).
//
// This is the per-drink counterpart to scripts/refresh_prices.mjs (which
// refreshes a venue's single cheapest-pint baseline). It targets the E1 drinks
// menu: named drinks, grouped by category, each with their own price.
//
// WHAT IS REAL in this scaffold:
//   - reads the permissible-source allowlist (data/price_sources.json
//     drinkSources) and REFUSES to proceed on any source whose `kind` is not
//     permissible or that is not explicitly marked `permissible: true`;
//   - validates every candidate row with the SAME hand-rolled guard the app
//     uses (mirrors lib/drinkPriceUpdates.ts isValidDrinkPriceUpdate) — bad
//     rows are dropped, counted, and reported;
//   - writes a versioned file
//     public/data/drink_price_updates/prices_YYYYMMDD.json (+ latest.json
//     alias) in the documented schema;
//   - opens a pull request with the new file via the GitHub CLI (`gh`), so a
//     human reviews every price change before it ships. Never pushes to main;
//   - runs `npm run validate-data` after writing, so a bad file never lands
//     even in the PR branch.
//
// WHAT IS REAL for the wetherspoons-official source (Wave 3):
//   - fetchFromDrinkSource() dispatches the "wetherspoons-official" source id to
//     a REAL first-party fetch: robots.txt pre-flight (abort if disallowed),
//     project User-Agent, >=1s (site asks Crawl-delay: 10) with jitter,
//     exponential backoff on 429/5xx, an on-disk per-run response cache and an
//     overall request budget. It reads the pub-menus sitemap, filters to London
//     pubs, fetches each pub's first-party /pub-menus/{slug}/ page, parses its
//     identity + any PRICED menu items, matches each priced row to OUR dataset
//     venueGroupingKey (unmatched DROPPED), and stamps source+observedAt.
//   - PROBE FINDING (honest): the first-party WEB pages carry pub identity + a
//     link to a chain-wide menu PDF but NO per-drink prices (prices live only in
//     the native Order & Pay app's private backend). So against today's real
//     payloads the priced-item list is empty and this source contributes ZERO
//     rows — reported honestly, never faked. The pipeline is real and will emit
//     rows the moment a first-party priced feed exists. See lib/wetherspoons.ts.
//   - Every other source id still returns [] (documented no-op).
//
// PERMISSION, settled 2026-10-16 (it used to fail open):
//   - A source with a fetcher is read ONLY when its lib/harvest/sourcePolicy.ts
//     row (DRINK_SOURCE_POLICY_IDS) is allowed. `wetherspoon-menu-prices` is
//     refused (`publishes-no-web-price`), so today the run logs a REFUSED line,
//     makes NO request and exits 0: an expected refusal is a recorded decision,
//     not an outage, and the weekly workflow and the local scheduler (which runs
//     this lane first and stops on a failure) stay green.
//   - Every request goes through scripts/lib/permittedHarvestFetch.mjs: the URL
//     must sit on the policy row's own host and pass `isHarvestableOperatorUrl`,
//     and robots.txt is read by lib/harvest/robots.ts, so a 401, 403, challenge
//     page, 5xx or unreachable host is a refusal and a 404 is permission.
//   - latest.json holds every lane's rows, so a write REPLACES only the
//     publishers this run produced and refuses a merge that would leave under
//     MIN_SHARE_OF_EXISTING_ROWS of the committed file.
//
// GOVERNANCE (hard rules — do not remove):
//   - NO scraping of competitor price/review sites (Vivino, Untappd, price
//     aggregators). Only first-party chain/venue sites and open-data feeds
//     listed in data/price_sources.json drinkSources, and only entries marked
//     `permissible: true`.
//   - Every emitted price carries { source: {label, url, licence}, observedAt }.
//   - A refreshed price is "sourced" (attributed), never community.
//   - Never present stale as live — observedAt is required and validated.
//
// Run:  node scripts/refresh_drink_prices.mjs [--open-pr]
//   --open-pr   also open a GitHub PR with the new file (needs `gh` auth).

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { createRobotsChecker } from "../lib/harvest/robots.ts";
import { CONTACT_EMAIL } from "../lib/siteContact.mjs";
import {
  HarvestRefusal,
  createPermittedFetch,
  isOnPermittedSourceHost,
  permittedHarvestSource,
} from "./lib/permittedHarvestFetch.mjs";
import { mergeDrinkUpdates } from "./lib/venueMatch.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const __dirname = dirname(MODULE_PATH);
const ROOT = join(__dirname, "..");
const ALLOWLIST_PATH = join(ROOT, "data", "price_sources.json");
const OUT_DIR = join(ROOT, "public", "data", "drink_price_updates");

const PERMISSIBLE_KINDS = new Set(["first-party-chain", "first-party-venue", "open-data"]);
const DRINK_CATEGORIES = new Set([
  "beer",
  "wine",
  "whisky",
  "gin",
  "vodka",
  "rum",
  "cocktail",
  "shot",
  "alcohol-free",
  "soft-drink",
  "coffee",
  "other",
]);

// --- validation (mirror of lib/drinkPriceUpdates.ts isValidDrinkPriceUpdate) --

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isHttpUrl(v) {
  if (!isNonEmptyString(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function isValidDrinkPriceUpdate(row, now) {
  if (typeof row !== "object" || row === null) return false;
  if (!isNonEmptyString(row.venueKey)) return false;
  if (!isNonEmptyString(row.drinkName)) return false;
  if (!isNonEmptyString(row.category) || !DRINK_CATEGORIES.has(row.category)) return false;
  if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) return false;
  const s = row.source;
  if (typeof s !== "object" || s === null) return false;
  if (!isNonEmptyString(s.label)) return false;
  if (!isHttpUrl(s.url)) return false;
  if (!isNonEmptyString(s.licence)) return false;
  if (!isNonEmptyString(row.observedAt)) return false;
  const ms = Date.parse(row.observedAt);
  return Number.isFinite(ms) && ms <= now;
}

// --- allowlist ----------------------------------------------------------------

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  const sources = Array.isArray(raw.drinkSources) ? raw.drinkSources : [];
  const permissible = [];
  for (const src of sources) {
    if (!PERMISSIBLE_KINDS.has(src.kind)) {
      console.warn(`SKIP source "${src.id}": kind "${src.kind}" is not permissible`);
      continue;
    }
    if (src.permissible !== true) {
      console.warn(`SKIP source "${src.id}": not marked permissible: true`);
      continue;
    }
    if (!isHttpUrl(src.url)) {
      console.warn(`SKIP source "${src.id}": url is not an http(s) URL`);
      continue;
    }
    if (!isNonEmptyString(src.licence)) {
      console.warn(`SKIP source "${src.id}": missing licence`);
      continue;
    }
    permissible.push(src);
  }
  return permissible;
}

// --- Wetherspoons first-party fetcher (Wave 3) --------------------------------

const UA =
  `PubMaxxingBot/1.0 (+https://pubmaxxing.app; drink-price research; contact ${CONTACT_EMAIL})`;
/**
 * Which lib/harvest/sourceRegistry.ts row PERMITS each allowlisted drink source
 * that has a fetcher. The two tables are read together and the narrower one
 * binds (docs/rules/scripts-harvest-and-source-permission.md), so a source with
 * a fetcher and no permitting row fetches nothing at all.
 */
export const DRINK_SOURCE_POLICY_IDS = Object.freeze({
  "wetherspoons-official": "wetherspoon-menu-prices",
});
// Politeness floor. The policy row's own Crawl-delay is honoured above it.
const MIN_CRAWL_DELAY_MS = 1_000;
const REQUEST_BUDGET = 300; // hard ceiling of network requests per run
const MAX_RETRIES = 4;

// London bounds (approx Greater London bbox) for the London-only filter, applied
// via matched dataset rows' lat/lng.
const LONDON_BOUNDS = { minLat: 51.28, maxLat: 51.70, minLng: -0.52, maxLng: 0.34 };

function jitter(ms) {
  return ms + Math.floor(Math.random() * 400);
}
function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// One rate-limited, cached, backing-off GET through the permission door. `ctx`
// carries the per-run cache (URL->text), the request count and the door. A
// HarvestRefusal (fence, robots or a refused redirect landing) is never retried.
async function politeGet(url, ctx) {
  if (ctx.cache.has(url)) return ctx.cache.get(url);
  if (ctx.requests >= REQUEST_BUDGET) {
    throw new Error(`Request budget (${REQUEST_BUDGET}) exhausted — aborting run.`);
  }
  let attempt = 0;
  for (;;) {
    // Space every network request by the crawl delay (except the very first).
    if (ctx.requests > 0) await ctx.sleep(jitter(ctx.crawlDelayMs));
    ctx.requests += 1;
    let res;
    try {
      res = await ctx.fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xml,application/json" },
      });
    } catch (err) {
      if (err instanceof HarvestRefusal) throw err;
      if (attempt >= MAX_RETRIES) throw err;
      await ctx.sleep(2 ** attempt * 1000);
      attempt += 1;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`GET ${url} failed with ${res.status} after ${attempt} retries.`);
      }
      await ctx.sleep(2 ** attempt * 1000);
      attempt += 1;
      continue;
    }
    if (!res.ok) {
      // A 4xx (not 429) on a PAGE is a hard answer about that page: skip it.
      // robots.txt never reaches here; the door asked it already.
      const text = "";
      ctx.cache.set(url, text);
      console.warn(`  GET ${url} -> ${res.status} (skipped)`);
      return text;
    }
    const text = await res.text();
    ctx.cache.set(url, text);
    return text;
  }
}

// --- parse helpers (mirror lib/wetherspoons.ts; JS runtime cannot import the TS
// module directly, so the pure logic is duplicated and both are snapshot-tested
// against the SAME fixtures via __tests__/wetherspoons.test.ts). ---------------

const MENU_PATH_RE = /\/pub-menus\/([^/]+)\/?$/;
const MULTIWORD_LOCALITY_TAILS = [
  "city-of-london",
  "stoke-newington",
  "newton-abbot",
  "ruislip-manor",
  "st-andrews",
];
// Keep taxonomy lanes aligned with lib/wetherspoons.ts CATEGORY_RULES.
const CATEGORY_RULES = [
  { test: /cocktail|pitcher|spritz/i, category: "cocktail" },
  { test: /\bshots?\b|shooter/i, category: "shot" },
  { test: /whisk(e)?y|bourbon|scotch/i, category: "whisky" },
  { test: /\bgin\b/i, category: "gin" },
  { test: /vodka/i, category: "vodka" },
  { test: /\brum\b/i, category: "rum" },
  { test: /wine|prosecco|champagne|sparkling/i, category: "wine" },
  { test: /beer|lager|ale|cider|stout|draught|pint|craft/i, category: "beer" },
  { test: /coffee|hot drink/i, category: "coffee" },
  {
    test: /alcohol.?free|non-alcoholic|no & low|no and low|0\.0/i,
    category: "alcohol-free",
  },
  { test: /soft drink/i, category: "soft-drink" },
  { test: /\bother\b/i, category: "other" },
];

function titleCase(v) {
  return v
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function slugFromMenuUrl(url) {
  try {
    const m = new URL(url).pathname.match(MENU_PATH_RE);
    return m ? m[1] : null;
  } catch {
    const m = url.match(MENU_PATH_RE);
    return m ? m[1] : null;
  }
}
function splitPubSlug(slug) {
  const clean = slug.trim().toLowerCase();
  for (const tail of MULTIWORD_LOCALITY_TAILS) {
    if (clean.endsWith(`-${tail}`)) {
      return { name: titleCase(clean.slice(0, clean.length - tail.length - 1)), locality: titleCase(tail) };
    }
  }
  const parts = clean.split("-");
  if (parts.length <= 1) return { name: titleCase(clean), locality: "" };
  return { name: titleCase(parts.slice(0, -1).join("-")), locality: titleCase(parts[parts.length - 1]) };
}
function matchGroup(input, re) {
  const m = input.match(re);
  return m ? m[1].trim() : null;
}
function cleanName(v) {
  return v
    .replace(/\s*[-–|]\s*J\.?\s*D\.?\s*Wetherspoon.*$/i, "")
    .replace(/\s*[-–|]\s*Wetherspoon.*$/i, "")
    .trim();
}
function parsePubMenuPage(html, sourceUrl) {
  const slug = slugFromMenuUrl(sourceUrl);
  if (!slug) return null;
  const { name: slugName, locality } = splitPubSlug(slug);
  const h1 = matchGroup(html, /<h1[^>]*>([^<]+)<\/h1>/i);
  const ogTitle = matchGroup(html, /<meta\s+property="og:title"\s+content="([^"]+)"/i);
  const displayName = cleanName(h1 ?? ogTitle ?? slugName);
  const canonical =
    matchGroup(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i) ??
    matchGroup(html, /<meta\s+property="og:url"\s+content="([^"]+)"/i) ??
    sourceUrl;
  const menuDocUrl = matchGroup(
    html,
    /href="(https:\/\/www\.jdwetherspoon\.com\/wp-content\/uploads\/menus\/[^"']+\.pdf)"/i,
  );
  return { name: displayName, locality, pageUrl: canonical, menuDocUrl: menuDocUrl ?? null };
}
function mapSectionToCategory(section) {
  if (typeof section !== "string" || section.trim() === "") return null;
  for (const rule of CATEGORY_RULES) if (rule.test.test(section)) return rule.category;
  return null;
}
// Extract PRICED menu items from a first-party payload. Today's real pages carry
// none (see probe finding); this scans for any embedded application/json menu
// blob with {name, section, price} rows should the shape ever gain one.
function extractPricedItems(html) {
  const items = [];
  const re = /<script[^>]*type="application\/json"[^>]*data-menu[^>]*>(.*?)<\/script>/gis;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const blob = JSON.parse(m[1]);
      const rows = Array.isArray(blob) ? blob : Array.isArray(blob.items) ? blob.items : [];
      for (const r of rows) {
        if (r && typeof r.name === "string" && typeof r.section === "string") {
          const price = typeof r.priceGbp === "number" ? r.priceGbp : Number(r.price);
          if (Number.isFinite(price)) {
            items.push({ name: r.name, section: r.section, priceGbp: price, servingSize: r.servingSize });
          }
        }
      }
    } catch {
      /* not our blob — ignore */
    }
  }
  return items;
}

// --- venue matcher (mirror lib/wetherspoons.ts matchVenue) --------------------

function normaliseMatch(v) {
  return v
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|jd|j d|wetherspoon(s)?|pub|bar)\b/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function matchTokens(v) {
  return new Set(normaliseMatch(v).split(" ").filter((t) => t.length > 1));
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}
function matchVenue(identity, dataset, minScore = 0.6) {
  const nameTokens = matchTokens(identity.name);
  if (nameTokens.size === 0) return null;
  const loc = normaliseMatch(identity.locality);
  const scored = [];
  for (const v of dataset) {
    const score = jaccard(nameTokens, matchTokens(v.name));
    if (score < minScore) continue;
    if (loc) {
      const addr = normaliseMatch(v.address);
      const locOk = loc.split(" ").some((p) => p.length > 2 && addr.includes(p));
      if (!locOk) continue;
    }
    scored.push({ ...v, score });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tie = scored[1];
  if (tie && tie.score === top.score && tie.venueKey !== top.venueKey) return null;
  return top;
}

// --- OUR dataset -> matchable venue rows (venueGroupingKey mirror) ------------

function normVenueKeyPart(v) {
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}
function venueGroupingKeyOf(row) {
  return [
    normVenueKeyPart(row.pub_name),
    normVenueKeyPart(row.address),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join("|");
}
function loadDatasetVenues() {
  const raw = JSON.parse(readFileSync(join(ROOT, "public", "data", "pint_prices_app_dataset.json"), "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.rows || [];
  return rows
    .filter((r) => typeof r.pub_name === "string" && Number.isFinite(Number(r.latitude)))
    .map((r) => ({
      venueKey: venueGroupingKeyOf(r),
      name: r.pub_name,
      address: r.address || "",
      lat: Number(r.latitude),
      lng: Number(r.longitude),
    }));
}
function inLondon(lat, lng) {
  return (
    lat >= LONDON_BOUNDS.minLat &&
    lat <= LONDON_BOUNDS.maxLat &&
    lng >= LONDON_BOUNDS.minLng &&
    lng <= LONDON_BOUNDS.maxLng
  );
}

// --- per-source dispatch ------------------------------------------------------

/**
 * Fetch one allowlisted drink source. Returns `{ rows, refused }`: `refused` is
 * the logged reason when the source was not read at all.
 *
 * Options: `limit`, `scratchCacheDir`, and for tests `fetchImpl`, `sleep` and
 * `robots` (a `createRobotsChecker` result). No option names a URL: every URL
 * comes from the policy row or from the pages that row permits.
 */
export async function fetchFromDrinkSource(source, options = {}) {
  const policyId = DRINK_SOURCE_POLICY_IDS[source.id];
  if (!policyId) {
    // Every other allowlisted source has no fetcher: a documented no-op that
    // makes no request.
    return { rows: [], refused: null };
  }
  const permission = permittedHarvestSource(policyId);
  if (!permission.allowed) {
    console.log(`  ${source.id}: ${permission.message}`);
    return { rows: [], refused: permission.message };
  }
  if (source.id === "wetherspoons-official") {
    return fetchWetherspoons(source, permission.source, options);
  }
  return { rows: [], refused: null };
}

async function fetchWetherspoons(source, policySource, options) {
  const { limit = 200, scratchCacheDir = null, fetchImpl = fetch, sleep = defaultSleep } = options;
  const robots = options.robots ?? createRobotsChecker({ fetchImpl });
  const ctx = {
    cache: new Map(),
    requests: 0,
    sleep,
    fetch: createPermittedFetch({ source: policySource, fetchImpl, robots }),
    crawlDelayMs: Math.max(MIN_CRAWL_DELAY_MS, (policySource.crawlDelaySeconds ?? 10) * 1000),
  };
  // The sitemap URL is the POLICY ROW's, never a constant of this script.
  const sitemapUrl = policySource.url;
  const menusUrl = new URL("/pub-menus/", sitemapUrl).href;

  // 1) ROBOTS PRE-FLIGHT through lib/harvest/robots.ts: every identity this
  //    harvest answers to, and an unreadable file (401, 403, challenge, 5xx or
  //    no answer) is a refusal. A 404 publishes no restriction.
  try {
    await ctx.fetch.assertPermitted(sitemapUrl);
    await ctx.fetch.assertPermitted(menusUrl);
  } catch (error) {
    if (!(error instanceof HarvestRefusal)) throw error;
    console.log(`  ${source.id}: ${error.message}`);
    return { rows: [], refused: error.message };
  }
  console.log(`  robots.txt: /pub-menus/ ALLOWED (crawl-delay ${ctx.crawlDelayMs / 1000}s honoured).`);

  // 2) Sitemap -> candidate pub-menu URLs.
  const sitemapXml = await politeGet(sitemapUrl, ctx);
  const listed = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  // A <loc> is somebody else's string: only one on the row's own host, past the
  // fence, is a candidate.
  const allUrls = listed.filter((url) => isOnPermittedSourceHost(policySource, url));
  console.log(
    `  sitemap: ${allUrls.length} pub-menu URLs` +
      (listed.length > allUrls.length ? ` (${listed.length - allUrls.length} off-host or refused, dropped).` : "."),
  );

  // 3) Build dataset + resolve which pub URLs plausibly map to a LONDON venue in
  //    OUR dataset — so we spend budget only on relevant pubs.
  const dataset = loadDatasetVenues();
  const londonDataset = dataset.filter((v) => inLondon(v.lat, v.lng));

  const candidates = [];
  for (const url of allUrls) {
    const slug = slugFromMenuUrl(url);
    if (!slug) continue;
    const identity = { ...splitPubSlug(slug), pageUrl: url, menuDocUrl: null };
    const match = matchVenue(identity, londonDataset);
    if (match) candidates.push({ url, identity, match });
    if (candidates.length >= limit) break;
  }
  console.log(`  ${candidates.length} pub(s) pre-matched to London dataset venues (limit ${limit}).`);

  // 4) Fetch each matched pub's menu page, parse, emit priced+matched rows.
  const observedAt = new Date().toISOString();
  const rows = [];
  let priced = 0;
  for (const cand of candidates) {
    let html;
    try {
      html = await politeGet(cand.url, ctx);
    } catch (error) {
      if (!(error instanceof HarvestRefusal)) throw error;
      console.warn(`  ${error.message}`);
      continue;
    }
    if (!html) continue;
    if (scratchCacheDir) {
      try {
        writeFileSync(join(scratchCacheDir, `${slugFromMenuUrl(cand.url)}.html`), html, "utf8");
      } catch {
        /* scratch cache best-effort */
      }
    }
    const identity = parsePubMenuPage(html, cand.url);
    if (!identity) continue;
    // Re-match on the parsed (authoritative) identity, London-gated.
    const match = matchVenue(identity, londonDataset);
    if (!match) continue;
    const items = extractPricedItems(html);
    for (const item of items) {
      const category = mapSectionToCategory(item.section);
      if (!category) continue;
      priced += 1;
      rows.push({
        venueKey: match.venueKey,
        drinkName: item.name.trim(),
        category,
        priceGbp: item.priceGbp,
        servingSize: item.servingSize,
        source: { label: source.label, url: identity.pageUrl, licence: source.licence },
        observedAt,
      });
    }
  }
  console.log(
    `  wetherspoons: fetched ${ctx.requests} request(s); ${candidates.length} matched pubs; ` +
      `${priced} priced row(s) extracted.`,
  );
  if (priced === 0) {
    console.log(
      "  HONEST RESULT: first-party pub-menu pages carry NO per-drink prices " +
        "(prices live only in the Order & Pay app). 0 rows contributed — see lib/wetherspoons.ts.",
    );
  }
  return { rows, refused: null };
}

// --- writing latest.json ------------------------------------------------------

/**
 * The smallest merged file, as a share of the committed one, that may replace
 * it. latest.json holds every lane's rows; a write that loses a tenth of them is
 * a broken merge, not a price change.
 */
const MIN_SHARE_OF_EXISTING_ROWS = 0.9;

function publisherOf(row) {
  return String(row?.source?.label ?? "").trim().toLowerCase();
}

/**
 * Merge this run's rows into the committed latest.json rows.
 *
 * Only the rows of the publishers THIS run produced are replaced; every other
 * lane's rows are kept as they are. Returns `{ ok: false, message }` when the
 * result would hold fewer than MIN_SHARE_OF_EXISTING_ROWS of the existing rows,
 * and the caller then writes nothing.
 */
export function planLatestDrinkWrite({ existing, incoming }) {
  const publishers = new Set(incoming.map(publisherOf));
  const retained = existing.filter((row) => !publishers.has(publisherOf(row)));
  const merged = mergeDrinkUpdates(retained, incoming);
  const floor = Math.ceil(existing.length * MIN_SHARE_OF_EXISTING_ROWS);
  if (merged.length < floor) {
    return {
      ok: false,
      merged,
      replaced: existing.length - retained.length,
      message:
        `REFUSED write: the merge would leave ${merged.length} of ${existing.length} existing rows ` +
        `(floor ${floor}, ${MIN_SHARE_OF_EXISTING_ROWS} of the committed file). Nothing written.`,
    };
  }
  return { ok: true, merged, replaced: existing.length - retained.length, message: null };
}

/** The committed rows, [] when no file exists. An unreadable file is a refusal. */
function readExistingDrinkUpdates(path) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || !Array.isArray(parsed.updates)) {
    throw new Error(`${path} holds no updates array — refusing to overwrite it.`);
  }
  return parsed.updates;
}

/** A review branch unique to this run, so a same-day rerun does not collide at push. */
export function reviewBranchName(date = new Date()) {
  const iso = date.toISOString();
  return `drink-price-refresh/${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

// --- main ---------------------------------------------------------------------

function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function reviewedFactMatches(row, input, venue, source, validator, now) {
  const allowedKeys = new Set(["venueKey", "drinkName", "category", "priceGbp", "source", "observedAt", "lane", "servingSize", "itemId"]);
  return typeof row === "object" && row !== null &&
    Object.keys(row).every((key) => allowedKeys.has(key)) &&
    row.venueKey === input.venueKey && row.source?.url === input.sourceUrl &&
    Object.keys(row.source).every((key) => ["label", "url", "licence"].includes(key)) &&
    row.observedAt === input.observedAt && row.lane === "publisher" &&
    /^\d+(?:\.\d{1,2})?$/.test(String(row.priceGbp)) &&
    row.source?.label === `${venue.pub_name} official drinks menu` &&
    row.source?.licence === source.licence && validator(row, now);
}

function readBoundedReviewFile(path, limit) {
  if (statSync(path).size > limit) throw new Error("Reviewed file exceeds its size limit");
  const bytes = readFileSync(path);
  if (bytes.byteLength > limit) throw new Error("Reviewed file exceeds its size limit");
  return bytes;
}

function reviewedPublisherForInput(input, policy, venues) {
  const source = loadAllowlist().find((row) => row.id === input.sourceId);
  if (!source) throw new Error("Reviewed source is not in the permissible refresh allowlist");
  const curated = JSON.parse(readFileSync(join(ROOT, "public/data/pint_prices_app_dataset.json"), "utf8"));
  const matches = curated.filter((row) => venues.venueGroupingKey(row) === input.venueKey);
  if (matches.length === 0 || venues.stableVenueIdFromKey(input.venueKey) !== input.venueId) {
    throw new Error("Reviewed venue identity does not match the curated dataset");
  }
  const venue = matches[0];
  const hostOf = (url) => policy.normalizeHarvestHostname(new URL(url).hostname)?.replace(/^www\./, "");
  if (!venue.website || hostOf(venue.website) !== hostOf(input.sourceUrl) ||
      hostOf(input.sourcePageUrl) !== hostOf(venue.website)) {
    throw new Error("Reviewed source does not belong to the curated venue");
  }
  const youngsPubs = JSON.parse(readFileSync(join(ROOT, "data/london_chains/youngs/garden_pubs_raw.json"), "utf8"));
  if (!youngsPubs.some((pub) => hostOf(pub.url) === hostOf(venue.website))) {
    throw new Error("The curated microsite is not bound to the recorded Young's publisher");
  }
  for (const url of [input.sourcePageUrl, input.sourceUrl]) {
    if (!policy.isHarvestableOperatorUrl(url) ||
        !policy.isHarvestableChainMenuUrl(url, "youngs-menu-prices", [hostOf(venue.website)])) {
      throw new Error("Reviewed source is refused by sourcePolicy");
    }
  }
  return { source, venue };
}

// Explicit reviewed-input publication is separate from the retrieval-only run.
// The input checksum pins the facts reviewed by the operator, and the cached
// PDF checksum pins the document. No menu or discovery request is made here.
export async function importReviewedDrinkPrices(inputPath, {
  expectedSha256,
  sourcePdfPath,
  scratchDir = null,
  fetchImpl = fetch,
} = {}) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? "")) throw new Error("A reviewed input SHA-256 is required");
  if (!sourcePdfPath) throw new Error("The reviewed source PDF is required");
  const inputBytes = readBoundedReviewFile(inputPath, 100_000);
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  if (sha(inputBytes) !== expectedSha256) throw new Error("Reviewed input checksum mismatch");
  const input = JSON.parse(inputBytes.toString("utf8"));
  if (input.version !== 1 || input.sourceId !== "youngs-official") throw new Error("Unsupported reviewed source");
  if (!Array.isArray(input.updates) || input.updates.length < 1 || input.updates.length > 22) {
    throw new Error("Reviewed imports require 1 to 22 menu facts");
  }
  const pdfBytes = readBoundedReviewFile(sourcePdfPath, 12 * 1024 * 1024);
  if (pdfBytes.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("The cached source is not a bounded PDF");
  }
  if (sha(pdfBytes) !== input.sourcePdfSha256) throw new Error("Source PDF checksum mismatch");

  const { tsImport } = await import("tsx/esm/api");
  const [drinks, policy, robots, venues] = await Promise.all([
    tsImport("../lib/drinkPriceUpdates.ts", import.meta.url),
    tsImport("../lib/harvest/sourcePolicy.ts", import.meta.url),
    tsImport("../lib/harvest/robots.ts", import.meta.url),
    tsImport("../lib/venues.ts", import.meta.url),
  ]);
  const { source, venue } = reviewedPublisherForInput(input, policy, venues);

  const now = Date.now();
  const incoming = input.updates.map((row) => {
    if (!reviewedFactMatches(row, input, venue, source, drinks.isValidDrinkPriceUpdate, now)) {
      throw new Error("Reviewed fact has a source, venue, date or row-shape mismatch");
    }
    return { ...row, itemId: drinks.reviewedDrinkItemId(row) };
  });
  if (drinks.parseDrinkPriceUpdates(incoming, now).length !== incoming.length) {
    throw new Error("Reviewed facts contain duplicate or ambiguous item identities");
  }
  const existingBody = JSON.parse(readFileSync(join(OUT_DIR, "latest.json"), "utf8"));
  const existing = Array.isArray(existingBody) ? existingBody : existingBody.updates;
  if (!Array.isArray(existing) || existing.some((row) => !drinks.isValidDrinkPriceUpdate(row, now)) ||
      drinks.parseDrinkPriceUpdates(existing, now).length !== existing.length) {
    throw new Error("Existing snapshot is malformed or has ambiguous identities");
  }
  const keyOf = (row) => JSON.stringify([row.venueKey, row.drinkName.toLowerCase(), row.category,
    row.servingSize?.trim().toLowerCase() ?? ""]);
  const held = new Map(existing.map((row) => [keyOf(row), row]));
  const added = [];
  for (const row of incoming) {
    const previous = held.get(keyOf(row));
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) {
      throw new Error("A bounded reviewed import may not replace an existing observation");
    }
    if (!previous) added.push(row);
  }
  const updates = [...existing, ...added];
  if (drinks.parseDrinkPriceUpdates(updates, now).length !== updates.length) {
    throw new Error("Reviewed import conflicts with an existing item ID");
  }
  const checker = robots.createRobotsChecker({ fetchImpl });
  const permissions = [];
  for (const url of [input.sourcePageUrl, input.sourceUrl]) {
    const permission = await checker(url);
    if (!permission.allowed) throw new Error(`Reviewed source robots refusal: ${permission.reason}`);
    permissions.push({ url, ...permission });
  }
  if (added.length === 0) return { written: false, addedRows: 0, totalRows: existing.length, permissions };

  const generatedAt = updates.reduce((latest, row) =>
    Date.parse(row.observedAt) > Date.parse(latest) ? row.observedAt : latest, updates[0].observedAt);
  const stamp = generatedAt.slice(0, 10).replaceAll("-", "");
  const body = {
    ...(Array.isArray(existingBody) ? { version: 1 } : existingBody),
    generatedAt,
    updates,
    reviewedImports: [...(existingBody.reviewedImports ?? []), {
      sourceId: input.sourceId,
      venueId: input.venueId,
      sourceUrl: input.sourceUrl,
      observedAt: input.observedAt,
      inputSha256: expectedSha256,
      sourcePdfSha256: input.sourcePdfSha256,
      itemCount: incoming.length,
    }],
  };
  const outDir = scratchDir ?? OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const paths = [join(outDir, `prices_${stamp}.json`), join(outDir, "latest.json")];
  for (const path of paths) {
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    renameSync(temp, path);
  }
  return { written: true, addedRows: added.length, totalRows: updates.length, generatedAt,
    inputSha256: expectedSha256, sourcePdfSha256: input.sourcePdfSha256, paths, permissions };
}

function parseArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

async function main() {
  const openPr = process.argv.includes("--open-pr");
  // --limit: broad default ~200 London pubs, within the per-run request budget.
  const limit = Math.max(1, Number(parseArg("--limit", "200")) || 200);
  // --scratch <dir>: write output + response cache to a scratch dir instead of
  // the shipped public/ path (used by the evidence dry run; never commit it).
  const scratchDir = parseArg("--scratch", null);
  const reviewedInput = parseArg("--reviewed-input", null);
  if (reviewedInput) {
    if (openPr) throw new Error("Reviewed imports are committed through their existing review branch");
    const result = await importReviewedDrinkPrices(reviewedInput, {
      expectedSha256: parseArg("--reviewed-sha256", null),
      sourcePdfPath: parseArg("--source-pdf", null),
      scratchDir,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const now = Date.now();
  const sources = loadAllowlist();
  console.log(`Permissible drink sources: ${sources.length} (limit=${limit})`);

  if (scratchDir) mkdirSync(scratchDir, { recursive: true });
  const options = { limit, scratchCacheDir: scratchDir };

  const raw = [];
  for (const source of sources) {
    const { rows, refused } = await fetchFromDrinkSource(source, options);
    if (refused) console.log(`  ${source.id}: not read this run (refusal recorded above).`);
    console.log(`  ${source.id}: ${rows.length} candidate row(s)`);
    raw.push(...rows);
  }

  let dropped = 0;
  const valid = [];
  for (const row of raw) {
    if (isValidDrinkPriceUpdate(row, now)) valid.push(row);
    else dropped += 1;
  }
  if (dropped > 0) console.warn(`Dropped ${dropped} invalid row(s)`);

  if (valid.length === 0) {
    console.log("No valid updates this run — nothing to write.");
    return;
  }

  const stamp = todayStamp();

  // --scratch routes ALL output to a throwaway dir and skips both the shipped
  // latest.json alias and the PR path — used by the evidence dry run.
  if (scratchDir) {
    const scratchOut = join(scratchDir, `prices_${stamp}.json`);
    const scratchBody = { version: 1, generatedAt: new Date().toISOString(), updates: valid };
    writeFileSync(scratchOut, `${JSON.stringify(scratchBody, null, 2)}\n`, "utf8");
    console.log(`[scratch] wrote ${valid.length} update(s) to ${scratchOut} (no latest.json, no PR).`);
    return;
  }

  // latest.json holds every lane's rows (Greene King, venue sites and more), so
  // this run REPLACES only its own publishers' rows and refuses a mass drop.
  const latestPath = join(OUT_DIR, "latest.json");
  const existing = readExistingDrinkUpdates(latestPath);
  const plan = planLatestDrinkWrite({ existing, incoming: valid });
  if (!plan.ok) throw new Error(plan.message);
  const body = { version: 1, generatedAt: new Date().toISOString(), updates: plan.merged };

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `prices_${stamp}.json`);
  writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  // Stable alias the client fetches (404-tolerant) — always the newest file.
  writeFileSync(latestPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${valid.length} update(s) merged into ${plan.merged.length} row(s) ` +
      `(${plan.replaced} of this run's publishers' rows replaced) to ${outPath} (+ latest.json)`,
  );

  // Validate before ever proposing a PR — a bad file must never leave this
  // machine, even on a review branch.
  try {
    execFileSync("node", [join(ROOT, "scripts", "validate-data.mjs")], { stdio: "inherit" });
  } catch (err) {
    console.error("validate-data failed on the freshly written file — aborting before any PR.");
    throw err;
  }

  if (!openPr) {
    console.log("Run with --open-pr to open a review PR.");
    return;
  }

  // Open a PR so a human reviews every price change. Never push to main.
  const branch = reviewBranchName();
  execFileSync("git", ["checkout", "-b", branch], { stdio: "inherit" });
  execFileSync("git", ["add", outPath, latestPath], { stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(drink-prices): refresh ${stamp} (${valid.length} sourced)`], {
    stdio: "inherit",
  });
  execFileSync("git", ["push", "-u", "origin", branch], { stdio: "inherit" });
  execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `Drink price refresh ${stamp}`,
      "--body",
      "Automated permissible-source drink-price refresh. Every price carries a first-party source + licence + observedAt. Review before merge.",
    ],
    { stdio: "inherit" },
  );
  console.log("Opened review PR.");
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
