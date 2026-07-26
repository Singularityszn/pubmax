#!/usr/bin/env node
// Build per-city slim venue indexes from OSM seed packs:
//   data/cities/{city}/osm_pubs.json
// → public/data/cities/{city}/venues_slim.json
//
// Venue shape matches London slim venues (lib/venuesSlim.ts) so the map can
// load city packs the same way. IDs are city-salted FNV-1a hashes so they
// never collide with London `venue-…` ids:
//   venue-{shortPrefix}-{fnv36}   e.g. venue-mcr-1ufn31x
//
// cheapestPrice is always null — OSM has no prices; Pint Drops fill them later.
//
// Usage:
//   node scripts/build_city_slim_index.mjs --city=manchester
//   node scripts/build_city_slim_index.mjs

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CITIES } from "./fetch_city_osm_pubs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  let city = null;
  for (const arg of argv) {
    if (arg.startsWith("--city=")) city = arg.slice("--city=".length).trim().toLowerCase();
  }
  return { city };
}

function normaliseVenueKeyPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** City-salted grouping key — mirrors lib/venues.ts venueGroupingKey + city salt. */
function cityVenueGroupingKey(cityId, pub) {
  return [
    cityId,
    normaliseVenueKeyPart(pub.name),
    normaliseVenueKeyPart(pub.address ?? ""),
    Number(pub.lat).toFixed(5),
    Number(pub.lng).toFixed(5),
  ].join("|");
}

/** FNV-1a 32-bit → base36, prefixed with venue-{shortPrefix}- to avoid London collisions. */
function stableCityVenueId(shortPrefix, key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${shortPrefix}-${(hash >>> 0).toString(36)}`;
}

export function cityVenueIdForPub(city, pub) {
  const key = cityVenueGroupingKey(city.id, pub);
  return stableCityVenueId(city.shortPrefix, key);
}

function inBbox(lat, lng, bbox) {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

function truthyOutdoor(pub) {
  return pub.outdoorSeating === true;
}

function buildFilterHints(pub, displayName) {
  const searchParts = new Set(
    [pub.name, pub.address, displayName, pub.cuisine, pub.brewery]
      .map((part) => String(part ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    searchText: Array.from(searchParts).join(" "),
    amenities: {
      food: Boolean(pub.cuisine),
      cocktails: false,
      beerGarden: truthyOutdoor(pub),
      liveSports: false,
      nonAlcoholic: false,
    },
    curation: {
      nearWater: false,
      hasStory: Boolean(pub.wikidata || pub.wikipedia),
    },
    canonical: false,
  };
}

/**
 * @param {{ id: string, displayName: string, shortPrefix: string, bbox: [number, number, number, number] }} city
 * @param {{ city?: string, pubs: any[] }} pack
 */
export function buildCitySlim(city, pack) {
  const pubs = Array.isArray(pack.pubs) ? pack.pubs : [];
  const slim = [];
  const seenIds = new Set();
  let droppedOob = 0;
  let droppedDup = 0;

  for (const pub of pubs) {
    const lat = Number(pub.lat);
    const lng = Number(pub.lng);
    const name = String(pub.name ?? "").trim();
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!inBbox(lat, lng, city.bbox)) {
      droppedOob += 1;
      continue;
    }

    const id = cityVenueIdForPub(city, { name, address: pub.address, lat, lng });
    if (seenIds.has(id)) {
      droppedDup += 1;
      continue;
    }
    seenIds.add(id);

    slim.push({
      id,
      name,
      lat,
      lng,
      cheapestPrice: null,
      borough: city.displayName,
      filterHints: buildFilterHints(pub, city.displayName),
    });
  }

  return { slim, droppedOob, droppedDup };
}

async function buildCity(city) {
  const packPath = path.join(ROOT, "data", "cities", city.id, "osm_pubs.json");
  const outDir = path.join(ROOT, "public", "data", "cities", city.id);
  const outPath = path.join(outDir, "venues_slim.json");

  try {
    await access(packPath);
  } catch {
    throw new Error(`Missing OSM pack: ${path.relative(ROOT, packPath)} — run fetch:city-pubs first`);
  }

  const pack = JSON.parse(await readFile(packPath, "utf8"));
  const { slim, droppedOob, droppedDup } = buildCitySlim(city, pack);

  await mkdir(outDir, { recursive: true });
  const text = JSON.stringify(slim);
  await writeFile(outPath, text);

  const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
  console.log(
    `${city.id}: ${slim.length} venues → ${path.relative(ROOT, outPath)} (${kb} KB)` +
      (droppedOob || droppedDup
        ? `  [dropped oob=${droppedOob} dup=${droppedDup}]`
        : ""),
  );
  return slim.length;
}

async function main() {
  const { city: cityArg } = parseArgs(process.argv.slice(2));
  const targets = cityArg
    ? [CITIES[cityArg]].filter(Boolean)
    : Object.values(CITIES).filter((c) => c.enabled);

  if (cityArg && !CITIES[cityArg]) {
    console.error(`Unknown city "${cityArg}". Known: ${Object.keys(CITIES).join(", ")}`);
    process.exit(1);
  }
  if (targets.length === 0) {
    console.error("No cities to build.");
    process.exit(1);
  }

  for (const city of targets) {
    await buildCity(city);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
