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
  isChainPage,
  keepEvidencedAmenities,
  liftSiteStamps,
  matchPubToVenue,
  mergeChainDenylists,
  parseChainDenylist,
  parsePubAmenityModelJson,
  projectPubAmenitySpend,
  provenChainEvidence,
  pubSpecificEvidence,
  spendFromTokenCounts,
  stampAmenityColumns,
} from "../../../lib/harvest/pubWebsiteAmenities.ts";
import { stableVenueIdFromKey, venueGroupingKey } from "../../../lib/venues.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const PUBS_PATH = path.join(ROOT, "data/osm/uk/uk_osm_pubs.json");
const DATASET_PATH = path.join(ROOT, "public/data/pint_prices_app_dataset.json");
const EVIDENCE_PATH = path.join(ROOT, "data/amenities/london_pub_website_evidence.json");
const CHAIN_PAGES_PATH = path.join(ROOT, "data/amenities/london_pub_website_chain_pages.json");
const CHECKPOINT_DIR = path.join(ROOT, "data-harvest/pub-website-amenities");
const CHECKPOINT_PATH = path.join(CHECKPOINT_DIR, "checkpoint.json");

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
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    let next;
    try {
      next = new URL(match[1], base);
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
    if (!parsed || typeof parsed !== "object") return { spentUsd: 0, byOsmId: {} };
    return {
      spentUsd: Number(parsed.spentUsd ?? 0),
      byOsmId: parsed.byOsmId && typeof parsed.byOsmId === "object" ? parsed.byOsmId : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { spentUsd: 0, byOsmId: {} };
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

/**
 * The committed evidence with this run's pages laid over it, and the chain
 * list with this run's readers and what they prove. Every pub that read a
 * page is a reader, whatever came of the read, and its quotes count before
 * the chain rule drops any of them.
 */
function mergeEvidence(previous, fresh, knownChainPages) {
  const skipCounts = { ...(previous?.skipCounts ?? {}) };
  const candidates = (previous?.rows ?? []).filter((row) => !fresh.has(row.osmId));
  const reads = [];
  for (const [osmId, entry] of fresh) {
    if (entry.sourceUrl) reads.push({ osmId, sourceUrl: entry.sourceUrl, amenities: entry.amenities ?? {} });
    if (entry.status !== "ok") {
      const status = entry.status ?? "unknown";
      skipCounts[status] = (skipCounts[status] ?? 0) + 1;
      continue;
    }
    candidates.push({
      osmId,
      name: entry.name,
      venueId: entry.venueId,
      sourceUrl: entry.sourceUrl,
      verifiedAt: entry.verifiedAt,
      amenities: entry.amenities ?? {},
    });
  }
  const chainPages = mergeChainDenylists(knownChainPages, provenChainEvidence([...candidates, ...reads]));
  const rows = pubSpecificEvidence(candidates, chainPages).sort((a, b) => a.osmId.localeCompare(b.osmId));
  const unused = candidates.length - rows.length;
  if (unused > 0) skipCounts.ok = (skipCounts.ok ?? 0) + unused;
  return { rows, skipCounts, chainPages };
}

async function main() {
  if (process.argv.includes("--restamp")) {
    restampFromEvidence();
    return;
  }
  const limit = argValue("--limit") ? Number(argValue("--limit")) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    console.error("--limit needs a positive integer");
    process.exit(1);
  }

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

  const pubs = [];
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
    pubs.push({ ...site, venueId: venue?.venueId ?? null });
  }
  pubs.sort((a, b) => Number(Boolean(b.venueId)) - Number(Boolean(a.venueId)) || a.osmId.localeCompare(b.osmId));

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
  const queue = pubs.filter((pub) => !byOsmId[pub.osmId]);
  const work = limit === null ? queue : queue.slice(0, limit);
  let cursor = 0;
  let writeChain = Promise.resolve();
  let stopped = false;

  const save = () => {
    writeChain = writeChain.then(() => {
      const next = { spentUsd: spent, byOsmId };
      const temp = `${CHECKPOINT_PATH}.tmp`;
      writeFileSync(temp, JSON.stringify(next));
      renameSync(temp, CHECKPOINT_PATH);
    });
    return writeChain;
  };

  async function one(pub) {
    let sourceUrl;
    try {
    if (stopped || spent >= SPEND_STOP_USD) {
      stopped = true;
      return;
    }
    if (!isHarvestableOperatorUrl(pub.website)) {
      byOsmId[pub.osmId] = { status: "refused-host", venueId: pub.venueId };
      return;
    }
    if (isChainPage(pub.website, knownChainPages)) {
      byOsmId[pub.osmId] = { status: "chain-page", venueId: pub.venueId };
      return;
    }
    const permission = await robots(pub.website);
    if (!permission.allowed) {
      byOsmId[pub.osmId] = { status: permission.reason ?? "robots-denied", venueId: pub.venueId };
      return;
    }
    const home = await readHtml(pub.website);
    if (!home.ok) {
      byOsmId[pub.osmId] = { status: home.reason, venueId: pub.venueId };
      return;
    }
    sourceUrl = home.url;
    if (isChainPage(home.url, knownChainPages)) {
      byOsmId[pub.osmId] = { status: "chain-page", venueId: pub.venueId, sourceUrl: home.url };
      return;
    }
    const landedPermission = await robots(home.url);
    if (!landedPermission.allowed) {
      byOsmId[pub.osmId] = { status: landedPermission.reason ?? "robots-denied", venueId: pub.venueId };
      return;
    }
    let text = home.text;
    const extraLinks = sameHostLinks(home.html, home.url);
    for (const link of extraLinks.slice(0, 1)) {
      if (!isHarvestableOperatorUrl(link) || isChainPage(link, knownChainPages)) continue;
      const extraPermission = await robots(link);
      if (!extraPermission.allowed) continue;
      const extra = await readHtml(link);
      if (!extra.ok) continue;
      text = `${text}\n${extra.text}`.slice(0, PAGE_CHAR_CAP);
      break;
    }
    if (text.length < 40) {
      byOsmId[pub.osmId] = { status: "empty-page", venueId: pub.venueId, sourceUrl: home.url };
      return;
    }
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
      byOsmId[pub.osmId] = { status: parsed.reason, venueId: pub.venueId, sourceUrl: home.url, usd: cost.usd };
      return;
    }
    const kept = keepEvidencedAmenities(parsed.amenities, text);
    byOsmId[pub.osmId] = {
      status: "ok",
      venueId: pub.venueId,
      name: pub.name,
      sourceUrl: home.url,
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

  const previous = readEvidence();
  const { rows: evidenceRows, skipCounts, chainPages } = mergeEvidence(previous, fresh, knownChainPages);
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
