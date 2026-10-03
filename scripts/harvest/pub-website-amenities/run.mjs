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
// --restamp stamps the committed evidence file onto the pint dataset through
// the same gate. It reads no checkpoint, fetches nothing and calls no model.
// A stamp only fills a blank cell and cannot be taken back, so run it on the
// unstamped dataset, for example straight after `npm run export:data`.
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
  PUB_WEBSITE_AMENITY_KEYS,
  keepEvidencedAmenities,
  matchPubToVenue,
  parsePubAmenityModelJson,
  projectPubAmenitySpend,
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
  const groups = new Map();
  for (const row of rows) {
    const id = stableVenueIdFromKey(venueGroupingKey(row));
    const bucket = groups.get(id) ?? {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      nonAlcoholic: false,
    };
    const yes = (value) => ["yes", "true", "y", "1"].includes(String(value ?? "").trim().toLowerCase());
    if (yes(row.food)) bucket.food = true;
    if (yes(row.cocktails)) bucket.cocktails = true;
    if (yes(row.beer_garden)) bucket.beerGarden = true;
    if (yes(row.live_sports)) bucket.liveSports = true;
    if (yes(row.non_alcoholic)) bucket.nonAlcoholic = true;
    groups.set(id, bucket);
  }
  const counts = { venues: groups.size, food: 0, cocktails: 0, beerGarden: 0, liveSports: 0, nonAlcoholic: 0, any: 0, none: 0 };
  for (const bucket of groups.values()) {
    const flags = ["food", "cocktails", "beerGarden", "liveSports", "nonAlcoholic"];
    if (flags.some((key) => bucket[key])) counts.any += 1;
    else counts.none += 1;
    for (const key of flags) if (bucket[key]) counts[key] += 1;
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

/** Stamp evidence rows onto the dataset file and report what changed. */
function stampDataset(dataset, evidenceRows) {
  const rowsByVenue = new Map();
  dataset.forEach((row, index) => {
    const venueId = stableVenueIdFromKey(venueGroupingKey(row));
    const bucket = rowsByVenue.get(venueId) ?? [];
    bucket.push(index);
    rowsByVenue.set(venueId, bucket);
  });
  const before = columnCoverage(dataset);
  let stampedRows = 0;
  let stampedVenues = 0;
  for (const entry of pubSpecificEvidence(evidenceRows)) {
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
  if (stampedRows > 0) {
    const datasetTemp = `${DATASET_PATH}.tmp`;
    writeFileSync(datasetTemp, JSON.stringify(dataset));
    renameSync(datasetTemp, DATASET_PATH);
  }
  return { before, after, stampedRows, stampedVenues };
}

function restampFromEvidence() {
  const evidence = readEvidence();
  if (!evidence || !Array.isArray(evidence.rows)) throw new Error("no committed evidence file to restamp from");
  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  if (!Array.isArray(dataset)) throw new Error("expected a pint dataset array");
  const { before, after, stampedRows, stampedVenues } = stampDataset(dataset, evidence.rows);
  const next = {
    ...evidence,
    columnCoverageBefore: evidence.columnCoverageBefore ?? before,
    columnCoverageAfter: after,
    stampedVenues,
    stampedRows,
  };
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(JSON.stringify({ stampedVenues, stampedRows, columnCoverageAfter: after }));
}

function evidenceFromCheckpoint(byOsmId) {
  const candidates = [];
  const skipCounts = {};
  for (const [osmId, entry] of Object.entries(byOsmId)) {
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
  const rows = pubSpecificEvidence(candidates).sort((a, b) => a.osmId.localeCompare(b.osmId));
  const unused = candidates.length - rows.length;
  if (unused > 0) skipCounts.ok = unused;
  return { rows, skipCounts };
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
  const byOsmId = checkpoint.byOsmId;
  const robots = createRobotsChecker();
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
    try {
    if (stopped || spent >= SPEND_STOP_USD) {
      stopped = true;
      return;
    }
    if (!isHarvestableOperatorUrl(pub.website)) {
      byOsmId[pub.osmId] = { status: "refused-host", venueId: pub.venueId };
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
    const landedPermission = await robots(home.url);
    if (!landedPermission.allowed) {
      byOsmId[pub.osmId] = { status: landedPermission.reason ?? "robots-denied", venueId: pub.venueId };
      return;
    }
    let text = home.text;
    const extraLinks = sameHostLinks(home.html, home.url);
    for (const link of extraLinks.slice(0, 1)) {
      if (!isHarvestableOperatorUrl(link)) continue;
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
      byOsmId[pub.osmId] = { status: "quota", venueId: pub.venueId, usd: cost.usd };
      return;
    }
    if (result.status !== 200) {
      byOsmId[pub.osmId] = { status: `model-${result.status}`, venueId: pub.venueId, usd: cost.usd };
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
      byOsmId[pub.osmId] = { status: "error", venueId: pub.venueId };
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (!stopped) {
      const index = cursor;
      cursor += 1;
      if (index >= work.length) return;
      await one(work[index]);
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
  const { rows: evidenceRows, skipCounts } = evidenceFromCheckpoint(byOsmId);
  const { before, after, stampedRows, stampedVenues } = stampDataset(dataset, evidenceRows);
  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  const evidence = {
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
    actualSpendUsd: Number(spent.toFixed(4)),
    jobCapUsd: JOB_SPEND_CAP_USD,
    columnCoverageBefore: previous?.columnCoverageBefore ?? before,
    columnCoverageAfter: after,
    stampedVenues,
    stampedRows,
    skipCounts,
    rows: evidenceRows,
  };
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    JSON.stringify({
      actualSpendUsd: evidence.actualSpendUsd,
      evidenceRows: evidenceRows.length,
      stampedVenues,
      stampedRows,
      columnCoverageBefore: evidence.columnCoverageBefore,
      columnCoverageAfter: after,
      stopped,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "harvest failed");
  process.exit(1);
});
