#!/usr/bin/env node
// Fetch amenity=pub nodes/ways for a UK city bbox via Overpass, then write:
//   data/cities/{city}/osm_pubs_raw.json   (raw Overpass response)
//   data/cities/{city}/osm_pubs.json       (normalized seed pack)
//
// Usage:
//   node scripts/fetch_city_osm_pubs.mjs --city=manchester
//   node scripts/fetch_city_osm_pubs.mjs                 # all enabled cities
//
// OSM data is © OpenStreetMap contributors, ODbL 1.0.
// One city at a time with a polite delay between requests.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** @typedef {{ id: string, displayName: string, shortPrefix: string, bbox: [number, number, number, number], enabled: boolean }} CityDef */

/** Inline city map — bbox is [south, west, north, east] (Overpass order).
 * Bounds match lib/cities.ts (latMin, lonMin, latMax, lonMax).
 * `enabled` here means "include in OSM seed-pack fetch/build" (all non-London
 * UK cities). Runtime map switcher enablement lives in lib/cities.ts. */
export const CITIES = /** @type {Record<string, CityDef>} */ ({
  manchester: {
    id: "manchester",
    displayName: "Manchester",
    shortPrefix: "mcr",
    bbox: [53.38, -2.35, 53.55, -2.1],
    enabled: true,
  },
  liverpool: {
    id: "liverpool",
    displayName: "Liverpool",
    shortPrefix: "liv",
    bbox: [53.35, -3.05, 53.48, -2.85],
    enabled: true,
  },
  oxford: {
    id: "oxford",
    displayName: "Oxford",
    shortPrefix: "oxf",
    bbox: [51.72, -1.3, 51.8, -1.2],
    enabled: true,
  },
  durham: {
    id: "durham",
    displayName: "Durham",
    shortPrefix: "dur",
    bbox: [54.76, -1.6, 54.8, -1.54],
    enabled: true,
  },
  glasgow: {
    id: "glasgow",
    displayName: "Glasgow",
    shortPrefix: "glw",
    bbox: [55.82, -4.35, 55.9, -4.15],
    enabled: true,
  },
  bristol: {
    id: "bristol",
    displayName: "Bristol",
    shortPrefix: "bri",
    bbox: [51.42, -2.65, 51.5, -2.52],
    enabled: true,
  },
  cambridge: {
    id: "cambridge",
    displayName: "Cambridge",
    shortPrefix: "cam",
    bbox: [52.18, 0.08, 52.24, 0.16],
    enabled: true,
  },
  bath: {
    id: "bath",
    displayName: "Bath",
    shortPrefix: "bat",
    bbox: [51.36, -2.4, 51.4, -2.32],
    enabled: true,
  },
});

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const INTER_CITY_DELAY_MS = 8_000;
const MAX_ATTEMPTS = 5;

function parseArgs(argv) {
  let city = null;
  let skipIfPresent = false;
  let fromRaw = false;
  for (const arg of argv) {
    if (arg.startsWith("--city=")) city = arg.slice("--city=".length).trim().toLowerCase();
    if (arg === "--skip-if-present") skipIfPresent = true;
    if (arg === "--from-raw") fromRaw = true;
  }
  return { city, skipIfPresent, fromRaw };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOverpassQuery(bbox) {
  const [south, west, north, east] = bbox;
  // out center so ways get a representative lat/lon without full geometry.
  return `
[out:json][timeout:90];
(
  node["amenity"="pub"](${south},${west},${north},${east});
  way["amenity"="pub"](${south},${west},${north},${east});
);
out center tags;
`.trim();
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchOverpass(query) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "PubMaxing/0.1 (UK city pub seed; contact: github.com/karanmrn/pubmax)",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const err = new Error(
          `Overpass ${response.status} from ${endpoint}: ${body.slice(0, 200)}`,
        );
        if (isRetryableStatus(response.status)) {
          lastError = err;
          const backoff = Math.min(60_000, 2_000 * 2 ** attempt);
          console.warn(`  rate-limit/backoff ${backoff}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
          await sleep(backoff);
          continue;
        }
        throw err;
      }
      return /** @type {Record<string, unknown>} */ (await response.json());
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS - 1) {
        const backoff = Math.min(60_000, 2_000 * 2 ** attempt);
        console.warn(`  fetch error, retry in ${backoff}ms: ${lastError.message}`);
        await sleep(backoff);
        continue;
      }
    }
  }
  throw lastError ?? new Error("Overpass fetch failed");
}

/**
 * @param {Record<string, string> | undefined} tags
 * @param {string} fallbackCity
 */
function buildAddress(tags, fallbackCity) {
  if (!tags) return fallbackCity;
  const parts = [];
  if (tags["addr:housenumber"]) parts.push(tags["addr:housenumber"]);
  if (tags["addr:street"]) parts.push(tags["addr:street"]);
  const city = tags["addr:city"] || fallbackCity;
  if (city) parts.push(city);
  if (tags["addr:postcode"]) parts.push(tags["addr:postcode"]);
  return parts.join(", ") || fallbackCity;
}

/**
 * @param {any} element
 * @param {string} displayName
 */
function normalizeElement(element, displayName) {
  const tags = element.tags ?? {};
  const name = typeof tags.name === "string" ? tags.name.trim() : "";
  if (!name) return null;

  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    osmId: `${element.type}/${element.id}`,
    name,
    lat,
    lng,
    address: buildAddress(tags, displayName),
    website: tags.website || tags["contact:website"] || null,
    phone: tags.phone || tags["contact:phone"] || null,
    openingHours: tags.opening_hours || null,
    brewery: tags.brewery || null,
    outdoorSeating: tags.outdoor_seating === "yes",
    cuisine: tags.cuisine || null,
    wikidata: tags.wikidata || null,
    wikipedia: tags.wikipedia || null,
  };
}

/**
 * @param {any} raw
 * @param {CityDef} city
 */
export function normalizeOverpass(raw, city) {
  const elements = Array.isArray(raw?.elements) ? raw.elements : [];
  const pubs = [];
  for (const element of elements) {
    const pub = normalizeElement(element, city.displayName);
    if (pub) pubs.push(pub);
  }
  // Stable order: south→north then west→east, then name.
  pubs.sort(
    (a, b) =>
      a.lat - b.lat || a.lng - b.lng || a.name.localeCompare(b.name) || a.osmId.localeCompare(b.osmId),
  );
  return {
    city: city.id,
    source: "OpenStreetMap Overpass",
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    fetchedAt: new Date().toISOString(),
    bbox: city.bbox,
    count: pubs.length,
    pubs,
  };
}

async function writeNormalized(city, raw, rawPath, normPath) {
  if (rawPath) {
    await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
    console.log(
      `  wrote ${path.relative(ROOT, rawPath)} (${Array.isArray(raw.elements) ? raw.elements.length : 0} elements)`,
    );
  }
  const normalized = normalizeOverpass(raw, city);
  await writeFile(normPath, `${JSON.stringify(normalized, null, 2)}\n`);
  console.log(`  wrote ${path.relative(ROOT, normPath)} (${normalized.count} named pubs)`);
  return normalized.count;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<"fetched" | "from-raw" | "skipped">}
 */
async function fetchCity(city, { fromRaw = false, skipIfPresent = false } = {}) {
  const outDir = path.join(ROOT, "data", "cities", city.id);
  await mkdir(outDir, { recursive: true });
  const rawPath = path.join(outDir, "osm_pubs_raw.json");
  const normPath = path.join(outDir, "osm_pubs.json");
  const rawExists = await fileExists(rawPath);

  if (skipIfPresent && rawExists) {
    console.log(`skip ${city.id} (raw already present; use without --skip-if-present to refresh)`);
    if (!(await fileExists(normPath))) {
      const raw = JSON.parse(await readFile(rawPath, "utf8"));
      await writeNormalized(city, raw, null, normPath);
    }
    return "skipped";
  }

  if (fromRaw) {
    if (!rawExists) {
      throw new Error(`--from-raw requested but missing ${path.relative(ROOT, rawPath)}`);
    }
    console.log(`normalizing ${city.id} from existing raw …`);
    const raw = JSON.parse(await readFile(rawPath, "utf8"));
    await writeNormalized(city, raw, null, normPath);
    return "from-raw";
  }

  const query = buildOverpassQuery(city.bbox);
  console.log(`fetching ${city.id} bbox=${city.bbox.join(",")} …`);
  const raw = await fetchOverpass(query);
  await writeNormalized(city, raw, rawPath, normPath);
  return "fetched";
}

async function main() {
  const { city: cityArg, skipIfPresent, fromRaw } = parseArgs(process.argv.slice(2));
  const targets = cityArg
    ? [CITIES[cityArg]].filter(Boolean)
    : Object.values(CITIES).filter((c) => c.enabled);

  if (cityArg && !CITIES[cityArg]) {
    console.error(`Unknown city "${cityArg}". Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }
  if (targets.length === 0) {
    console.error("No cities to fetch.");
    process.exit(1);
  }

  let needDelay = false;
  for (const city of targets) {
    if (needDelay) {
      console.log(`  waiting ${INTER_CITY_DELAY_MS}ms before next city (Overpass etiquette)…`);
      await sleep(INTER_CITY_DELAY_MS);
    }
    const result = await fetchCity(city, { fromRaw, skipIfPresent });
    needDelay = result === "fetched";
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
