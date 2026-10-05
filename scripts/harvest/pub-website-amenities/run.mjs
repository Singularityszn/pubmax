#!/usr/bin/env node
// Read each London pub's own website once, ask Gemini Flash-Lite for amenity
// JSON, and keep a true value only when its evidence is a quote from that page
// that states the amenity.
// Blank amenity columns on the pint dataset are then stamped "yes". The quote,
// source URL and verified day live in data/amenities/london_pub_website_evidence.json.
//
//   npm run harvest:pub-website-amenities
//   npm run harvest:pub-website-amenities -- --limit 1
//   npm run harvest:pub-website-amenities -- --restamp
//   npm run harvest:pub-website-amenities -- --copy-skipped --locate --read-only
//
// --copy-skipped reads only the pubs the pub copy pack skipped for
// insufficient stored facts, from the website OSM or the price dataset gives
// them. --locate asks Firecrawl search for the own site of such a pub that has
// none, and keeps a hit only when its host carries a distinctive word of the
// pub's name and the page states the pub's postcode, or its street when the
// dataset address gives no postcode. With FIRECRAWL_API_KEY
// set, a page the plain read could not get (timeout, failed connection, 429,
// 5xx, or almost no text) is read once more through Firecrawl, after the same
// robots and source checks. --firecrawl-requests caps those requests, default
// HARVEST_CLI_REQUEST_BUDGET. --read-only stops after reading and keeps each
// page's text under data-harvest/pub-website-amenities/pages, so a later run
// sends the model those pages without reading them again.
//
// Every run lifts the earlier site stamps, then stamps the committed evidence
// file onto the source dataset through the gate, so a rerun gives the same
// dataset and a tightened gate takes stamps away. --restamp does only that: it
// reads no checkpoint, fetches nothing and calls no model. A harvest adds this
// run's pages to the committed evidence; the checkpoint only says which pubs
// are already done.
//
// A page or quote proven chain-wide stays in
// data/amenities/london_pub_website_chain_pages.json, with every pub that has
// read each page, whatever came of the read, and every pub that has stated
// each quote. The harvest reads it before fetching and skips a pub whose page
// is on it, every stamp goes through it, and a harvest adds its readers and
// what they prove. A pub that kept no amenity, failed, or read a chain-wide
// page never reaches the evidence file, so without the list a later run that
// reads one of those pages or quotes alone would take it for the pub's own.
//
// Calls go to Vertex AI on project pubmaxx so the Google Cloud trial pays.
// The Gemini Developer API answered 402 (AI Studio prepay depleted) and does
// not bill that trial. No Google Places call is made. The script never prints
// an access token.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFirecrawlClient, createHarvestBudget, HARVEST_CLI_REQUEST_BUDGET } from "../../../lib/harvest/firecrawl.ts";
import { createRobotsChecker } from "../../../lib/harvest/robots.ts";
import {
  harvestRedirectLanding,
  isHarvestableOperatorUrl,
} from "../../../lib/harvest/sourcePolicy.ts";
import {
  FLASH_LITE_SKU,
  JOB_SPEND_CAP_USD,
  MAX_OUTPUT_TOKENS,
  PAGE_CHAR_CAP,
  PUB_WEBSITE_AMENITY_COLUMNS,
  PUB_WEBSITE_AMENITY_KEYS,
  firecrawlMayReread,
  isChainPage,
  keepEvidencedAmenities,
  locatedOwnSite,
  pageStatesPostcode,
  pageStatesStreet,
  postcodeOf,
  streetOf,
  liftSiteStamps,
  matchPubToVenue,
  mergeHarvestEvidence,
  parseChainDenylist,
  parsePubAmenityModelJson,
  projectPubAmenitySpend,
  pubSpecificEvidence,
  readExtraPage,
  spendFromTokenCounts,
  stampAmenityColumns,
} from "../../../lib/harvest/pubWebsiteAmenities.ts";
import { stableVenueIdFromKey, venueGroupingKey } from "../../../lib/venues.ts";
import { ownSiteFor } from "../../lib/parallelVenueDiscovery.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const PUBS_PATH = path.join(ROOT, "data/osm/uk/uk_osm_pubs.json");
const DATASET_PATH = path.join(ROOT, "public/data/pint_prices_app_dataset.json");
const EVIDENCE_PATH = path.join(ROOT, "data/amenities/london_pub_website_evidence.json");
const CHAIN_PAGES_PATH = path.join(ROOT, "data/amenities/london_pub_website_chain_pages.json");
const CHECKPOINT_DIR = path.join(ROOT, "data-harvest/pub-website-amenities");
const CHECKPOINT_PATH = path.join(CHECKPOINT_DIR, "checkpoint.json");
const PAGES_DIR = path.join(CHECKPOINT_DIR, "pages");
const COPY_PATH = path.join(ROOT, "data/venue_copy/london.json");

const LAT_MIN = 51.26;
const LAT_MAX = 51.72;
const LON_MIN = -0.55;
const LON_MAX = 0.3;
const SPEND_STOP_USD = 5;
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 400_000;
const USER_AGENT = "PUBMAXX-harvest/1";

const PROMPT = [
  "You read one pub's own web page and report amenities the page states.",
  "Return JSON with an amenities object. Keys, exactly:",
  PUB_WEBSITE_AMENITY_KEYS.join(", ") + ".",
  'Each key is {"value": boolean, "evidence": string}.',
  "Set value true only when the page states that this pub has that amenity.",
  "evidence must be a contiguous phrase copied from the page, at least 8 characters.",
  'If the page does not state it, value is false and evidence is "".',
  "food means the pub serves meals. cocktails means cocktails.",
  "beerGarden means a garden, terrace or outdoor seating.",
  "liveSports means televised sport.",
  "nonAlcoholic means alcohol-free or 0.0% beer, wine, cocktails or spirits. Tea, coffee, hot chocolate, soft drinks, juice, a spritz and a drink with a kids' meal do not count.",
  "darts means a dartboard to play at the pub, and pool means a pool table. Darts or pool shown on TV is liveSports, not darts or pool.",
  "liveMusic, pubQuiz, happyHour and karaoke mean those events at this pub.",
  "A TV screen alone is not liveSports, a DJ alone is not liveMusic, and a quiz machine is not pubQuiz.",
  "Do not use site navigation, chain-wide news or seasonal promotions that do not describe this pub.",
  "Do not infer from the pub name. Do not use anything that is not on the page.",
  "",
  "PAGE:",
].join("\n");

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function inLondon(lat, lng) {
  return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LON_MIN && lng <= LON_MAX;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function sameHostLinks(html, pageUrl) {
  const base = new URL(pageUrl);
  const found = [];
  const seen = new Set();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']|\]\(([^)\s#]+)/gi)) {
    let next;
    try {
      next = new URL(match[1] ?? match[2], base);
    } catch {
      continue;
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") continue;
    if (next.host !== base.host) continue;
    if (next.pathname === base.pathname) continue;
    if (!/menu|food|garden|terrace|sport|quiz|karaoke|whats-on|whatson|events/i.test(next.pathname)) {
      continue;
    }
    next.hash = "";
    const href = next.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    found.push(href);
    if (found.length >= 3) break;
  }
  return found;
}

async function readHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
    });
    const landed = response.url || url;
    const landing = harvestRedirectLanding(url, landed);
    if (landing.outcome === "refused") {
      await response.body?.cancel();
      return { ok: false, reason: "redirect-refused" };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, reason: `http-${response.status}` };
    }
    const type = response.headers.get("content-type") ?? "";
    if (type && !/html|xml|text\/plain/i.test(type)) {
      await response.body?.cancel();
      return { ok: false, reason: "not-html" };
    }
    const html = (await response.text()).slice(0, MAX_BYTES);
    return { ok: true, url: landing.url, html, text: htmlToText(html) };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : "fetch-failed";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

function usageCost(body) {
  const usage = body?.usageMetadata ?? {};
  const inputTokens = Number(usage.promptTokenCount ?? 0);
  const outputTokens =
    Number(usage.candidatesTokenCount ?? 0) + Number(usage.thoughtsTokenCount ?? 0);
  return {
    inputTokens,
    outputTokens,
    usd: spendFromTokenCounts({
      inputTokens,
      outputTokens,
      inputUsdPerMillion: FLASH_LITE_SKU.inputUsdPerMillion,
      outputUsdPerMillion: FLASH_LITE_SKU.outputUsdPerMillion,
    }),
  };
}

const VERTEX_PROJECT = "pubmaxx";
const VERTEX_LOCATION = "global";
let accessToken = "";
let accessTokenAt = 0;

function refreshAccessToken() {
  accessToken = execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  }).trim();
  accessTokenAt = Date.now();
  if (!accessToken) throw new Error("gcloud auth print-access-token returned nothing");
}

function vertexUrl(model) {
  const host =
    VERTEX_LOCATION === "global"
      ? "aiplatform.googleapis.com"
      : `${VERTEX_LOCATION}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${model}:generateContent`;
}

// Firecrawl search allows about 20 requests a minute on this plan; the
// workers share one slot so a burst never spends the run's request budget
// on 429 retries.
const SEARCH_SPACING_MS = 4_000;
let nextSearchSlot = 0;

async function paceSearch() {
  const now = Date.now();
  const slot = Math.max(now, nextSearchSlot);
  nextSearchSlot = slot + SEARCH_SPACING_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

let nextModelSlot = 0;

async function paceModelCall() {
  const now = Date.now();
  const slot = Math.max(now, nextModelSlot);
  nextModelSlot = slot + 400;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

async function askModel(pageText, attempt = 0) {
  if (!accessToken || Date.now() - accessTokenAt > 20 * 60 * 1000) refreshAccessToken();
  await paceModelCall();
  let response;
  try {
    response = await fetch(vertexUrl(FLASH_LITE_SKU.model), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${PROMPT}\n${pageText.slice(0, PAGE_CHAR_CAP)}` }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
      },
    }),
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401 && attempt < 1) {
    refreshAccessToken();
    return askModel(pageText, attempt + 1);
  }
  if (response.status === 429 && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 5000 * 2 ** attempt));
    return askModel(pageText, attempt + 1);
  }
  return { status: response.status, body };
  } catch {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      return askModel(pageText, attempt + 1);
    }
    return { status: 0, body: null };
  }
}

function loadCheckpoint() {
  try {
    const parsed = JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return { spentUsd: 0, byOsmId: {}, located: {} };
    return {
      spentUsd: Number(parsed.spentUsd ?? 0),
      byOsmId: parsed.byOsmId && typeof parsed.byOsmId === "object" ? parsed.byOsmId : {},
      located: parsed.located && typeof parsed.located === "object" ? parsed.located : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { spentUsd: 0, byOsmId: {}, located: {} };
    throw error;
  }
}

function columnCoverage(rows) {
  const yes = (value) => ["yes", "true", "y", "1"].includes(String(value ?? "").trim().toLowerCase());
  const groups = new Map();
  for (const row of rows) {
    const id = stableVenueIdFromKey(venueGroupingKey(row));
    const bucket = groups.get(id) ?? new Set();
    for (const key of PUB_WEBSITE_AMENITY_KEYS) {
      if (yes(row[PUB_WEBSITE_AMENITY_COLUMNS[key]])) bucket.add(key);
    }
    groups.set(id, bucket);
  }
  const counts = { venues: groups.size, ...Object.fromEntries(PUB_WEBSITE_AMENITY_KEYS.map((key) => [key, 0])), any: 0, none: 0 };
  for (const bucket of groups.values()) {
    if (bucket.size > 0) counts.any += 1;
    else counts.none += 1;
    for (const key of bucket) counts[key] += 1;
  }
  return counts;
}

function readEvidence() {
  try {
    return JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function runFlags() {
  const limit = argValue("--limit") ? Number(argValue("--limit")) : null;
  const firecrawlRequests = argValue("--firecrawl-requests") ? Number(argValue("--firecrawl-requests")) : HARVEST_CLI_REQUEST_BUDGET;
  const flags = {
    limit,
    copySkipped: process.argv.includes("--copy-skipped"),
    locate: process.argv.includes("--locate"),
    readOnly: process.argv.includes("--read-only"),
    firecrawlRequests,
  };
  const refusal = limit !== null && (!Number.isInteger(limit) || limit < 1) ? "--limit needs a positive integer"
    : !Number.isInteger(firecrawlRequests) || firecrawlRequests < 0 ? "--firecrawl-requests needs a whole number"
      : flags.locate && !flags.copySkipped ? "--locate needs --copy-skipped" : null;
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  return flags;
}

/** How each pub of a read-only run ended, by status, reader and whether its site was located. */
function readCounts(work, byOsmId) {
  const counts = {};
  for (const pub of work) {
    const entry = byOsmId[pub.osmId];
    const key = entry ? `${entry.status}${entry.reader ? `:${entry.reader}` : ""}${entry.located ? ":located" : ""}` : "not-reached";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * The pubs the copy pack skipped for insufficient stored facts and whose own
 * site has given no evidence yet. Each takes the website OSM gives it, else the
 * one the price dataset gives it, else none, and the postcode its dataset
 * address states. A pub with a website comes first.
 */
function copySkippedPubs(dataset, anchors, londonSites) {
  const copy = JSON.parse(readFileSync(COPY_PATH, "utf8"));
  const skipped = new Set(
    Object.entries(copy.skipped ?? {})
      .filter(([, skip]) => skip?.reason === "insufficient-stored-facts")
      .map(([venueId]) => venueId),
  );
  const evidenced = new Set((readEvidence()?.rows ?? []).map((row) => row.venueId).filter(Boolean));
  const siteByVenue = new Map();
  for (const site of londonSites) if (site.venueId && !siteByVenue.has(site.venueId)) siteByVenue.set(site.venueId, site);
  const rowsByVenue = new Map();
  for (const row of dataset) {
    const venueId = stableVenueIdFromKey(venueGroupingKey(row));
    rowsByVenue.set(venueId, [...(rowsByVenue.get(venueId) ?? []), row]);
  }
  const pubs = anchors
    .filter((anchor) => skipped.has(anchor.venueId) && !evidenced.has(anchor.venueId))
    .map((anchor) => {
      const rows = rowsByVenue.get(anchor.venueId) ?? [];
      const site = siteByVenue.get(anchor.venueId);
      const listed = rows.map((row) => String(row.website ?? "").trim()).find((url) => url.startsWith("http"));
      return {
        osmId: site?.osmId ?? `venue/${anchor.venueId}`,
        name: anchor.name,
        lat: anchor.lat,
        lng: anchor.lng,
        website: site?.website ?? listed ?? null,
        venueId: anchor.venueId,
        postcode: rows.map((row) => postcodeOf(String(row.address ?? ""))).find(Boolean) ?? null,
        street: rows.map((row) => streetOf(String(row.address ?? ""))).find(Boolean) ?? null,
      };
    });
  return [...pubs.filter((pub) => pub.website), ...pubs.filter((pub) => !pub.website)];
}

/**
 * Lift every earlier site stamp, then stamp the evidence onto what the source
 * said. The dataset that comes out depends only on the source rows and the
 * evidence, so a rerun changes nothing and a quote the gate now refuses loses
 * its stamp.
 */
function stampDataset(evidenceRows, chainPages) {
  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  if (!Array.isArray(dataset)) throw new Error("expected a pint dataset array");
  const rowsByVenue = new Map();
  dataset.forEach((row, index) => {
    dataset[index] = liftSiteStamps(row);
    const venueId = stableVenueIdFromKey(venueGroupingKey(row));
    const bucket = rowsByVenue.get(venueId) ?? [];
    bucket.push(index);
    rowsByVenue.set(venueId, bucket);
  });
  const before = columnCoverage(dataset);
  let stampedRows = 0;
  let stampedVenues = 0;
  for (const entry of pubSpecificEvidence(evidenceRows, chainPages)) {
    if (!entry.venueId) continue;
    let venueStamped = false;
    for (const index of rowsByVenue.get(entry.venueId) ?? []) {
      const result = stampAmenityColumns(dataset[index], entry.amenities);
      if (result.stamped.length === 0) continue;
      dataset[index] = result.row;
      stampedRows += 1;
      venueStamped = true;
    }
    if (venueStamped) stampedVenues += 1;
  }
  const after = columnCoverage(dataset);
  const datasetTemp = `${DATASET_PATH}.tmp`;
  writeFileSync(datasetTemp, JSON.stringify(dataset));
  renameSync(datasetTemp, DATASET_PATH);
  return { before, after, stampedRows, stampedVenues };
}

/** The evidence file with this run's stamp figures. The first honest before figure is kept. */
function withStampFigures(evidence, previous, stamps) {
  const keepCounts = stamps.stampedRows === 0 && previous;
  return {
    ...evidence,
    columnCoverageBefore: previous?.columnCoverageBefore ?? stamps.before,
    columnCoverageAfter: stamps.after,
    stampedVenues: keepCounts ? previous.stampedVenues : stamps.stampedVenues,
    stampedRows: keepCounts ? previous.stampedRows : stamps.stampedRows,
  };
}

/** The committed chain list. A missing file throws, because reading it as empty lets every chain page back in. */
function readChainPages() {
  return parseChainDenylist(JSON.parse(readFileSync(CHAIN_PAGES_PATH, "utf8")));
}

function writeChainPages(chainPages) {
  mkdirSync(path.dirname(CHAIN_PAGES_PATH), { recursive: true });
  writeFileSync(CHAIN_PAGES_PATH, `${JSON.stringify({ version: 1, ...chainPages }, null, 2)}\n`);
}

function writeEvidence(evidence) {
  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
}

function restampFromEvidence() {
  const evidence = readEvidence();
  if (!evidence || !Array.isArray(evidence.rows)) throw new Error("no committed evidence file to restamp from");
  const next = withStampFigures(evidence, evidence, stampDataset(evidence.rows, readChainPages()));
  writeEvidence(next);
  console.log(
    JSON.stringify({
      stampedVenues: next.stampedVenues,
      stampedRows: next.stampedRows,
      columnCoverageBefore: next.columnCoverageBefore,
      columnCoverageAfter: next.columnCoverageAfter,
    }),
  );
}

async function main() {
  if (process.argv.includes("--restamp")) {
    restampFromEvidence();
    return;
  }
  const { limit, copySkipped, locate, readOnly, firecrawlRequests } = runFlags();

  const pubsDoc = JSON.parse(readFileSync(PUBS_PATH, "utf8"));
  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  if (!Array.isArray(pubsDoc.pubs) || !Array.isArray(dataset)) {
    throw new Error("expected OSM pubs and a pint dataset array");
  }

  const anchors = [];
  const seenVenues = new Set();
  for (const row of dataset) {
    const venueId = stableVenueIdFromKey(venueGroupingKey(row));
    if (seenVenues.has(venueId)) continue;
    seenVenues.add(venueId);
    anchors.push({
      venueId,
      name: String(row.pub_name ?? ""),
      lat: Number(row.latitude),
      lng: Number(row.longitude),
    });
  }

  const londonSites = [];
  for (const pub of pubsDoc.pubs) {
    const website = typeof pub.website === "string" ? pub.website.trim() : "";
    if (!website.startsWith("http")) continue;
    if (!inLondon(Number(pub.lat), Number(pub.lng))) continue;
    const site = {
      osmId: String(pub.osmId),
      name: String(pub.name ?? ""),
      lat: Number(pub.lat),
      lng: Number(pub.lng),
      website,
    };
    const venue = matchPubToVenue(site, anchors);
    londonSites.push({ ...site, venueId: venue?.venueId ?? null });
  }
  const pubs = copySkipped ? copySkippedPubs(dataset, anchors, londonSites) : londonSites;
  if (!copySkipped) pubs.sort((a, b) => Number(Boolean(b.venueId)) - Number(Boolean(a.venueId)) || a.osmId.localeCompare(b.osmId));

  const inputTokensPerCallCap = Math.ceil((PAGE_CHAR_CAP + PROMPT.length) / 4);
  const fullProjected = projectPubAmenitySpend({
    calls: pubs.length,
    inputTokensPerCall: inputTokensPerCallCap,
    outputTokensPerCall: MAX_OUTPUT_TOKENS,
    inputUsdPerMillion: FLASH_LITE_SKU.inputUsdPerMillion,
    outputUsdPerMillion: FLASH_LITE_SKU.outputUsdPerMillion,
  });
  const calls = limit ?? pubs.length;
  const projected = projectPubAmenitySpend({
    calls,
    inputTokensPerCall: inputTokensPerCallCap,
    outputTokensPerCall: MAX_OUTPUT_TOKENS,
    inputUsdPerMillion: FLASH_LITE_SKU.inputUsdPerMillion,
    outputUsdPerMillion: FLASH_LITE_SKU.outputUsdPerMillion,
  });
  console.log(
    JSON.stringify({
      sku: FLASH_LITE_SKU.model,
      inputUsdPerMillion: FLASH_LITE_SKU.inputUsdPerMillion,
      outputUsdPerMillion: FLASH_LITE_SKU.outputUsdPerMillion,
      londonPubsWithWebsite: pubs.length,
      matchedSlimVenues: pubs.filter((pub) => pub.venueId).length,
      calls,
      inputTokensPerCallCap,
      outputTokensPerCallCap: MAX_OUTPUT_TOKENS,
      fullSetProjectedSpendUsd: Number(fullProjected.toFixed(4)),
      projectedSpendUsd: Number(projected.toFixed(4)),
      jobCapUsd: JOB_SPEND_CAP_USD,
    }),
  );
  if (fullProjected > JOB_SPEND_CAP_USD || projected > JOB_SPEND_CAP_USD) {
    console.error(`projected spend $${projected.toFixed(2)} is over the $${JOB_SPEND_CAP_USD} job cap; no model call made`);
    process.exit(2);
  }

  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const checkpoint = loadCheckpoint();
  let spent = Number(checkpoint.spentUsd ?? 0);
  const startSpent = spent;
  const byOsmId = checkpoint.byOsmId;
  const fresh = new Map();
  const robots = createRobotsChecker();
  const knownChainPages = readChainPages();
  const located = checkpoint.located;
  const firecrawl = createFirecrawlClient({ budget: createHarvestBudget(firecrawlRequests) });
  // A pub whose page was read under --read-only waits in the checkpoint as
  // "read" until a run that may call the model.
  const queue = pubs.filter((pub) => (pub.website || locate) && (!byOsmId[pub.osmId] || (!readOnly && byOsmId[pub.osmId].status === "read")));
  const work = limit === null ? queue : queue.slice(0, limit);
  let cursor = 0;
  let writeChain = Promise.resolve();
  let stopped = false;

  const save = () => {
    writeChain = writeChain.then(() => {
      const next = { spentUsd: spent, byOsmId, located };
      const temp = `${CHECKPOINT_PATH}.tmp`;
      writeFileSync(temp, JSON.stringify(next));
      renameSync(temp, CHECKPOINT_PATH);
    });
    return writeChain;
  };

  // A plain read first. A page the network or a script kept from it is read
  // once more through Firecrawl, which returns markdown and no HTML.
  async function readPage(url) {
    const plain = await readHtml(url);
    if (!firecrawl || !firecrawlMayReread(plain)) return { ...plain, reader: "fetch" };
    const scraped = await firecrawl.scrape(url, { onlyMainContent: false });
    if (!scraped.ok) return plain.ok ? { ...plain, reader: "fetch" } : { ok: false, reason: `firecrawl-${scraped.failure.reason}` };
    const status = scraped.page.statusCode;
    if (status !== null && status >= 400) return { ok: false, reason: `http-${status}` };
    const text = scraped.page.markdown.replace(/\s+/g, " ").trim().slice(0, MAX_BYTES);
    return { ok: true, url, html: scraped.page.markdown, text, reader: "firecrawl" };
  }

  // The own site of a pub with no website, found once and remembered. A search
  // that failed or was refused for budget answers undefined, so the pub stays
  // unread and a later run searches again.
  async function locateSite(pub) {
    if (Object.hasOwn(located, pub.osmId)) return located[pub.osmId];
    if (!pub.postcode && !pub.street) return null;
    if (!firecrawl) return undefined;
    await paceSearch();
    const where = pub.postcode ?? `"${pub.street.join(" ")}" London`;
    const found = await firecrawl.search(`"${pub.name}" pub ${where}`, { limit: 5 });
    if (!found.ok) return undefined;
    located[pub.osmId] = locatedOwnSite(pub.name, found.results, {
      chainPages: knownChainPages,
      isHarvestable: isHarvestableOperatorUrl,
      ownSite: (name, url) => ownSiteFor(name, url, { displayName: "London" }),
    });
    return located[pub.osmId];
  }

  const pagePath = (key) => path.join(PAGES_DIR, `${key.replace(/[^a-z0-9-]/gi, "_")}.json`);

  async function readSite(pub) {
    const website = pub.website ?? (locate ? await locateSite(pub) : null);
    if (website === undefined) return { status: null };
    if (!website) return { status: pub.website === null && locate ? "no-site-found" : "no-website" };
    if (!isHarvestableOperatorUrl(website)) return { status: "refused-host" };
    if (isChainPage(website, knownChainPages)) return { status: "chain-page" };
    const permission = await robots(website);
    if (!permission.allowed) return { status: permission.reason ?? "robots-denied" };
    const home = await readPage(website);
    if (!home.ok) return { status: home.reason };
    if (isChainPage(home.url, knownChainPages)) return { status: "chain-page", sourceUrl: home.url };
    const landedPermission = await robots(home.url);
    if (!landedPermission.allowed) return { status: landedPermission.reason ?? "robots-denied" };
    if (!pub.website && !(pub.postcode ? pageStatesPostcode(home.text, pub.postcode) : pageStatesStreet(home.text, pub.street))) return { status: "located-site-unconfirmed", sourceUrl: home.url };
    let text = home.text;
    const extraLinks = sameHostLinks(home.html, home.url);
    for (const link of extraLinks.slice(0, 1)) {
      const extraText = await readExtraPage(link, {
        chainPages: knownChainPages,
        isHarvestable: isHarvestableOperatorUrl,
        robots,
        readHtml: readPage,
      });
      if (extraText === null) continue;
      text = `${text}\n${extraText}`.slice(0, PAGE_CHAR_CAP);
      break;
    }
    if (text.length < 40) return { status: "empty-page", sourceUrl: home.url };
    return { status: "read", sourceUrl: home.url, reader: home.reader, located: !pub.website, text };
  }

  async function one(pub) {
    let sourceUrl;
    try {
    if (stopped || spent >= SPEND_STOP_USD) {
      stopped = true;
      return;
    }
    let read;
    if (byOsmId[pub.osmId]?.status === "read") {
      read = { ...byOsmId[pub.osmId], text: JSON.parse(readFileSync(pagePath(pub.osmId), "utf8")).text };
    } else {
      read = await readSite(pub);
      if (read.status === null) return;
      if (read.status !== "read") {
        byOsmId[pub.osmId] = { status: read.status, venueId: pub.venueId, ...(read.sourceUrl ? { sourceUrl: read.sourceUrl } : {}) };
        return;
      }
      mkdirSync(PAGES_DIR, { recursive: true });
      writeFileSync(pagePath(pub.osmId), JSON.stringify({ url: read.sourceUrl, reader: read.reader, readAt: new Date().toISOString(), text: read.text }));
      byOsmId[pub.osmId] = { status: "read", venueId: pub.venueId, name: pub.name, sourceUrl: read.sourceUrl, reader: read.reader, located: read.located };
      if (readOnly) return;
    }
    sourceUrl = read.sourceUrl;
    const text = read.text;
    const result = await askModel(text);
    const cost = usageCost(result.body);
    spent += cost.usd;
    if (result.status === 429) {
      byOsmId[pub.osmId] = { status: "quota", venueId: pub.venueId, sourceUrl, usd: cost.usd };
      return;
    }
    if (result.status !== 200) {
      byOsmId[pub.osmId] = { status: `model-${result.status}`, venueId: pub.venueId, sourceUrl, usd: cost.usd };
      return;
    }
    const textOut = result.body?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const parsed = parsePubAmenityModelJson(textOut);
    if (!parsed.ok) {
      byOsmId[pub.osmId] = { status: parsed.reason, venueId: pub.venueId, sourceUrl, usd: cost.usd };
      return;
    }
    const kept = keepEvidencedAmenities(parsed.amenities, text);
    byOsmId[pub.osmId] = {
      status: "ok",
      venueId: pub.venueId,
      name: pub.name,
      sourceUrl,
      verifiedAt: new Date().toISOString().slice(0, 10),
      amenities: kept,
      usd: cost.usd,
    };
    if (spent >= SPEND_STOP_USD) stopped = true;
    } catch {
      byOsmId[pub.osmId] = { status: "error", venueId: pub.venueId, sourceUrl };
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (!stopped) {
      const index = cursor;
      cursor += 1;
      if (index >= work.length) return;
      await one(work[index]);
      const done = byOsmId[work[index].osmId];
      if (done) fresh.set(work[index].osmId, done);
      if ((index + 1) % 10 === 0) await save();
      if ((index + 1) % 25 === 0) {
        const kept = Object.values(byOsmId).filter((row) => row.status === "ok" && Object.keys(row.amenities ?? {}).length > 0).length;
        console.log(`progress ${index + 1}/${work.length} kept=${kept} spentUsd=${spent.toFixed(4)}`);
      }
    }
  });
  await Promise.all(workers);
  await save();
  if (readOnly) {
    console.log(JSON.stringify({ readOnly: true, pubs: work.length, firecrawlRequests: firecrawl?.budget.spent() ?? 0, counts: readCounts(work, byOsmId) }));
    return;
  }

  const previous = readEvidence();
  const { rows: evidenceRows, skipCounts, chainPages } = mergeHarvestEvidence({
    previousRows: previous?.rows ?? [],
    previousSkipCounts: previous?.skipCounts,
    fresh,
    checkpoint: byOsmId,
    knownChainPages,
  });
  writeChainPages(chainPages);
  const evidence = withStampFigures({
    version: 1,
    model: FLASH_LITE_SKU.model,
    sku: {
      inputUsdPerMillion: FLASH_LITE_SKU.inputUsdPerMillion,
      outputUsdPerMillion: FLASH_LITE_SKU.outputUsdPerMillion,
      note: "Vertex AI Gemini 2.5 Flash-Lite standard text tier on project pubmaxx. No search grounding. Output price includes thinking tokens.",
    },
    projected: {
      calls,
      inputTokensPerCall: Math.ceil((PAGE_CHAR_CAP + PROMPT.length) / 4),
      outputTokensPerCall: MAX_OUTPUT_TOKENS,
      spendUsd: Number(projected.toFixed(4)),
    },
    actualSpendUsd: Number(((previous?.actualSpendUsd ?? 0) + spent - startSpent).toFixed(4)),
    jobCapUsd: JOB_SPEND_CAP_USD,
    skipCounts,
    rows: evidenceRows,
  }, previous, stampDataset(evidenceRows, chainPages));
  writeEvidence(evidence);
  console.log(
    JSON.stringify({
      actualSpendUsd: evidence.actualSpendUsd,
      evidenceRows: evidenceRows.length,
      stampedVenues: evidence.stampedVenues,
      stampedRows: evidence.stampedRows,
      columnCoverageBefore: evidence.columnCoverageBefore,
      columnCoverageAfter: evidence.columnCoverageAfter,
      stopped,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "harvest failed");
  process.exit(1);
});
