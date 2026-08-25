/**
 * All-UK pub harvest: OSM enumerate + Exa enrich.
 *
 * Observations only. Every stored fact carries sourceUrl + fetchedAt.
 * Nothing is inferred from a name, a chain or a postcode.
 *
 * OSM data is © OpenStreetMap contributors, ODbL 1.0.
 */

import { existsSync, readdirSync } from "node:fs";
import { access, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { MAX_BACKOFF_MS, QUERY_TIMEOUT_S } from "./overpassClient.mjs";
import { UK_AREA_ID } from "./ukOsmSeed.mjs";

export const ODBL_LICENSE = "ODbL-1.0";
export const ODBL_ATTRIBUTION = "© OpenStreetMap contributors";

export const SHARD_SIZE = 500;
export const EXA_SEARCH_URL = "https://api.exa.ai/search";
export const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
export const EXA_PACE_MS = 1_500;
export const EXA_MAX_ATTEMPTS = 6;
export const PROGRESS_FILE = "progress.json";

const SOCIAL_HOSTS = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
]);

const SOCIAL_OSM_KEYS = [
  ["contact:facebook", "facebook"],
  ["facebook", "facebook"],
  ["contact:instagram", "instagram"],
  ["instagram", "instagram"],
  ["contact:twitter", "twitter"],
  ["twitter", "twitter"],
  ["contact:tiktok", "tiktok"],
  ["tiktok", "tiktok"],
  ["contact:youtube", "youtube"],
  ["youtube", "youtube"],
];

function roundCoord(value) {
  return Math.round(value * 1e6) / 1e6;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function statedYes(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().toLowerCase() !== "no";
}

/**
 * A bar is kept only when OSM states real ale, a microbrewery, or a brewery.
 * A name that contains "pub" is not evidence.
 * @param {Record<string, string> | undefined} tags
 */
export function isPubLikeBar(tags) {
  if (!tags || tags.amenity !== "bar") return false;
  return statedYes(tags.real_ale) || tags.microbrewery === "yes" || statedYes(tags.brewery);
}

export function isHarvestableTags(tags) {
  if (!tags) return false;
  if (tags.amenity === "pub") return true;
  return isPubLikeBar(tags);
}

/**
 * Overpass QL for one grid cell: UK-area-clipped pubs and bars.
 * Pub-like filtering of bars happens after the response, so a drop is counted.
 * @param {[number, number, number, number]} bbox
 * @param {{ timeout?: number }} [options]
 */
export function buildHarvestOverpassQuery(bbox, { timeout = QUERY_TIMEOUT_S } = {}) {
  const box = bbox.map((n) => roundCoord(n)).join(",");
  return `
[out:json][timeout:${timeout}];
area(id:${UK_AREA_ID})->.uk;
(
  node["amenity"="pub"](area.uk)(${box});
  way["amenity"="pub"](area.uk)(${box});
  node["amenity"="bar"](area.uk)(${box});
  way["amenity"="bar"](area.uk)(${box});
);
out center tags;
`.trim();
}

export function osmObjectUrl(type, id) {
  if (!isNonEmptyString(type) || !Number.isFinite(Number(id))) return null;
  return `https://www.openstreetmap.org/${type}/${id}`;
}

function observation(kind, value, sourceUrl, fetchedAt) {
  if (!isNonEmptyString(value) || !isNonEmptyString(sourceUrl) || !isNonEmptyString(fetchedAt)) {
    return null;
  }
  return { kind, value: value.trim(), sourceUrl, fetchedAt };
}

function collectAddressTags(tags) {
  /** @type {Record<string, string>} */
  const addressTags = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (!key.startsWith("addr:")) continue;
    if (!isNonEmptyString(value)) continue;
    addressTags[key] = value.trim();
  }
  return addressTags;
}

function collectSocialTags(tags, sourceUrl, fetchedAt) {
  /** @type {Record<string, { value: string, sourceUrl: string, fetchedAt: string }>} */
  const socialTags = {};
  for (const [osmKey, field] of SOCIAL_OSM_KEYS) {
    if (socialTags[field]) continue;
    const value = tags?.[osmKey];
    const row = observation("social", value, sourceUrl, fetchedAt);
    if (!row) continue;
    socialTags[field] = { value: row.value, sourceUrl, fetchedAt };
  }
  return socialTags;
}

/**
 * @param {any} element
 * @param {{ fetchedAt: string }} options
 */
export function seedRowFromElement(element, { fetchedAt }) {
  const tags = element?.tags ?? {};
  const name = typeof tags.name === "string" ? tags.name.trim() : "";
  if (!name) return null;
  if (!isHarvestableTags(tags)) return null;

  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const type = typeof element.type === "string" ? element.type : null;
  const id = element.id;
  const sourceUrl = osmObjectUrl(type, id);
  if (!sourceUrl || !isNonEmptyString(fetchedAt)) return null;

  const websiteValue = tags.website || tags["contact:website"] || null;
  const website = isNonEmptyString(websiteValue)
    ? { value: websiteValue.trim(), sourceUrl, fetchedAt }
    : null;

  const addressTags = collectAddressTags(tags);
  const socialTags = collectSocialTags(tags, sourceUrl, fetchedAt);

  return {
    osmId: `${type}/${id}`,
    name,
    amenity: tags.amenity,
    lat,
    lng,
    addressTags,
    website,
    socialTags: Object.keys(socialTags).length > 0 ? socialTags : {},
    license: ODBL_LICENSE,
    attribution: ODBL_ATTRIBUTION,
    sourceUrl,
    fetchedAt,
  };
}

/**
 * Normalize raw Overpass elements into OSM-id-unique seed rows.
 * Bars that are not pub-like are dropped and counted.
 * @param {Iterable<any>} elements
 * @param {{ fetchedAt: string }} options
 */
export function normalizeHarvestElements(elements, { fetchedAt }) {
  const byOsmId = new Map();
  let droppedUnnamed = 0;
  let droppedPlainBar = 0;
  let droppedNoPoint = 0;
  for (const element of elements ?? []) {
    const tags = element?.tags ?? {};
    if (tags.amenity === "bar" && !isPubLikeBar(tags)) {
      droppedPlainBar += 1;
      continue;
    }
    const row = seedRowFromElement(element, { fetchedAt });
    if (!row) {
      const name = typeof tags.name === "string" ? tags.name.trim() : "";
      if (!name) droppedUnnamed += 1;
      else droppedNoPoint += 1;
      continue;
    }
    if (byOsmId.has(row.osmId)) continue;
    byOsmId.set(row.osmId, row);
  }
  const rows = [...byOsmId.values()].sort((a, b) => a.osmId.localeCompare(b.osmId));
  return {
    rows,
    drops: { unnamed: droppedUnnamed, plainBar: droppedPlainBar, noPoint: droppedNoPoint },
  };
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function pathnameOf(value) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function httpsUrl(value) {
  if (!isNonEmptyString(value)) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function looksLikeMenu(url, title) {
  const pathName = pathnameOf(url);
  const blob = `${pathName} ${title ?? ""}`.toLowerCase();
  return /\b(menu|drinks-list|wine-list|price-list)\b/.test(blob) || /\/(menu|menus|drinks)(\/|$)/.test(pathName);
}

function looksLikeHistory(text, title) {
  const blob = `${title ?? ""} ${text ?? ""}`;
  return /\b(since\s+\d{3,4}|founded|history|established|opened in)\b/i.test(blob);
}

/**
 * Classify one Exa hit. Null when there is no https source URL.
 * Never invents a kind from the pub's name alone.
 * @param {{ url?: string, title?: string, text?: string }} hit
 */
export function classifyExaHit(hit) {
  const url = httpsUrl(hit?.url);
  if (!url) return null;
  const host = hostnameOf(url);
  if (host && SOCIAL_HOSTS.has(host)) return { kind: "social", url };
  if (looksLikeMenu(url, hit?.title)) return { kind: "menu", url };
  const pathName = pathnameOf(url);
  if (pathName === "/" || pathName === "") return { kind: "website", url };
  if (looksLikeHistory(hit?.text, hit?.title)) return { kind: "history", url };
  if (isNonEmptyString(hit?.text) || isNonEmptyString(hit?.title)) return { kind: "coverage", url };
  return { kind: "website", url };
}

/**
 * @param {{ osmId: string, name: string }} pub
 * @param {any[]} results
 * @param {string} fetchedAt
 */
function pushObservation(observations, seen, kind, value, sourceUrl, fetchedAt, snippet) {
  const key = `${kind}|${sourceUrl}`;
  if (seen.has(key)) return;
  const row = observation(kind, value, sourceUrl, fetchedAt);
  if (!row) return;
  if (isNonEmptyString(snippet)) row.snippet = snippet.trim().slice(0, 1_200);
  seen.add(key);
  observations.push(row);
}

export function observationsFromExaResults(pub, results, fetchedAt) {
  const observations = [];
  const seen = new Set();
  for (const hit of Array.isArray(results) ? results : []) {
    const classified = classifyExaHit(hit);
    if (!classified) continue;

    if (classified.kind === "history") {
      const snippet = isNonEmptyString(hit.text) ? hit.text.trim() : hit.title?.trim();
      pushObservation(observations, seen, "history", snippet, classified.url, fetchedAt, snippet);
    } else if (classified.kind === "social") {
      pushObservation(observations, seen, "social", classified.url, classified.url, fetchedAt);
    } else if (classified.kind === "coverage") {
      const value = isNonEmptyString(hit.title) ? hit.title.trim() : classified.url;
      pushObservation(observations, seen, "coverage", value, classified.url, fetchedAt);
    } else {
      pushObservation(observations, seen, classified.kind, classified.url, classified.url, fetchedAt);
    }

    // A first-party page may also STATE history. That is a second observation
    // from the same sourceUrl, never a guess from the pub name.
    if (classified.kind !== "history" && looksLikeHistory(hit?.text, hit?.title)) {
      const snippet = isNonEmptyString(hit.text) ? hit.text.trim() : hit.title?.trim();
      pushObservation(observations, seen, "history", snippet, classified.url, fetchedAt, snippet);
    }
  }
  return observations;
}

export function exaApiKey(env = process.env) {
  const value = typeof env.EXA_API_KEY === "string" ? env.EXA_API_KEY.trim() : "";
  return value.length > 0 ? value : null;
}

export function isExaConfigured(env = process.env) {
  return exaApiKey(env) !== null;
}

export function backoffMs(attempt, retryAfterHeader) {
  const retryAfterS = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterS) && retryAfterS > 0) {
    return Math.min(MAX_BACKOFF_MS, retryAfterS * 1_000);
  }
  return Math.min(MAX_BACKOFF_MS, 4_000 * 2 ** attempt);
}

const MOCK_HISTORY = {
  "the turks head": {
    results: [
      {
        url: "https://www.turksheadscilly.co.uk/",
        title: "The Turks Head",
        text: "The Turks Head has served St Agnes since the nineteenth century.",
      },
      {
        url: "https://www.instagram.com/turksheadscilly",
        title: "Instagram",
      },
    ],
  },
};

/**
 * Deterministic Exa stand-in. Returns sourced hits for a tiny named fixture
 * set, and an empty result list for every other pub. Empty is honest: the mock
 * did not observe a page.
 * @param {{ name: string }} pub
 */
export function mockExaPayload(pub) {
  const haystack = String(pub?.name ?? "")
    .trim()
    .toLowerCase();
  for (const [key, payload] of Object.entries(MOCK_HISTORY)) {
    if (haystack === key || haystack.includes(key)) return payload;
  }
  return { results: [] };
}

function sleepDefault(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, mock?: boolean }} [options]
 */
export function createExaClient({
  env = process.env,
  fetchImpl = fetch,
  sleep = sleepDefault,
  mock = false,
} = {}) {
  if (mock) {
    return {
      mock: true,
      async search(query) {
        return mockExaPayload({ name: query });
      },
      async contents() {
        return { results: [] };
      },
    };
  }
  const key = exaApiKey(env);
  if (!key) return null;

  async function post(url, body) {
    let lastError = null;
    for (let attempt = 0; attempt < EXA_MAX_ATTEMPTS; attempt += 1) {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
        },
        body: JSON.stringify(body),
      });
      if (response.status === 429 || response.status === 502 || response.status === 503) {
        const wait = backoffMs(attempt, response.headers.get("retry-after"));
        lastError = new Error(`Exa ${response.status}`);
        await sleep(wait);
        continue;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Exa ${response.status}: ${text.slice(0, 200)}`);
      }
      return response.json();
    }
    throw lastError ?? new Error("Exa request failed");
  }

  return {
    mock: false,
    async search(query) {
      const payload = await post(EXA_SEARCH_URL, {
        query,
        type: "auto",
        numResults: 8,
        contents: { text: { maxCharacters: 1_200 } },
      });
      return { results: Array.isArray(payload?.results) ? payload.results : [] };
    },
    async contents(urls) {
      const payload = await post(EXA_CONTENTS_URL, {
        urls,
        text: { maxCharacters: 1_200 },
      });
      return { results: Array.isArray(payload?.results) ? payload.results : [] };
    },
  };
}

export function enrichPub(pub, exaPayload, fetchedAt) {
  return {
    osmId: pub.osmId,
    name: pub.name,
    lat: pub.lat,
    lng: pub.lng,
    observations: observationsFromExaResults(pub, exaPayload?.results, fetchedAt),
    fetchedAt,
  };
}

export function shardFileName(index) {
  return `shard_${String(index).padStart(4, "0")}.jsonl`;
}

export function nextShardIndexFromNames(names) {
  const complete = (Array.isArray(names) ? names : [])
    .filter((name) => /^shard_\d{4}\.jsonl$/.test(name))
    .map((name) => Number(name.slice(6, 10)));
  if (complete.length === 0) return 0;
  return Math.max(...complete) + 1;
}

export function nextShardIndex(dirOrNames) {
  if (Array.isArray(dirOrNames)) return nextShardIndexFromNames(dirOrNames);
  if (typeof dirOrNames !== "string" || !existsSync(dirOrNames)) return 0;
  return nextShardIndexFromNames(readdirSync(dirOrNames));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listCompleteShardIndexes(dir) {
  if (!(await fileExists(dir))) return [];
  const names = await readdir(dir);
  return names
    .filter((name) => /^shard_\d{4}\.jsonl$/.test(name))
    .map((name) => Number(name.slice(6, 10)))
    .sort((a, b) => a - b);
}

export async function writeJsonlAtomic(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp`);
  const body = `${(Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n")}${
    rows?.length ? "\n" : ""
  }`;
  try {
    await writeFile(temporaryPath, body);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function readJsonl(filePath) {
  const text = await readFile(filePath, "utf8");
  if (!text.trim()) return [];
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

export async function writeShardAtomic(dir, index, rows) {
  await mkdir(dir, { recursive: true });
  await writeJsonlAtomic(path.join(dir, shardFileName(index)), rows);
}

export async function writeProgress(dir, progress) {
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, PROGRESS_FILE);
  const temporaryPath = path.join(dir, `.${PROGRESS_FILE}.tmp`);
  const body = `${JSON.stringify(progress, null, 2)}\n`;
  try {
    await writeFile(temporaryPath, body);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function loadProgress(dir) {
  const filePath = path.join(dir, PROGRESS_FILE);
  if (!(await fileExists(filePath))) return null;
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function estimateEta({ remaining, elapsedMs, done, now = Date.now() }) {
  const ratePerMs = done > 0 && elapsedMs > 0 ? done / elapsedMs : 0;
  const ratePerHour = ratePerMs * 3_600_000;
  const remainingMs = ratePerMs > 0 ? remaining / ratePerMs : null;
  const etaIso =
    remainingMs === null ? null : new Date(now + remainingMs).toISOString();
  return { ratePerHour, remainingMs, etaIso };
}

export function harvestSearchQuery(pub) {
  const place =
    pub?.addressTags?.["addr:city"] ||
    pub?.addressTags?.["addr:town"] ||
    pub?.addressTags?.["addr:village"] ||
    "";
  const bits = [pub?.name, place, "UK pub official website history"].filter(Boolean);
  return bits.join(" ");
}

export function seedSample(rows, limit = 100) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit);
}
