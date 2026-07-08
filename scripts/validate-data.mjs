// Build-time data validation for the bundled datasets shipped in public/data.
//
// The app is deliberately keyless/offline and reads these JSON files directly,
// so a truncated or malformed dataset silently degrades the map instead of
// throwing. This script validates every bundled dataset with the SAME rules the
// app uses at runtime (mirroring lib/pois.ts isValidPoi) and exits non-zero on
// any error, so CI blocks a merge that would ship broken data.
//
// Plain Node ESM — no build step, no deps. Run: node scripts/validate-data.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const DATA_DIR = join(ROOT_DIR, "public", "data");
const GENERATED_DATA_DIR = join(ROOT_DIR, "data", "generated");
const DRINK_PRICE_UPDATES_DIR = join(DATA_DIR, "drink_price_updates");
const DRINK_CATEGORIES = new Set([
  "beer",
  "wine",
  "whisky",
  "gin",
  "vodka",
  "rum",
  "cocktail",
  "shot",
  "other",
]);

// ---------------------------------------------------------------------------
// Shared rules (kept in sync with the app)
// ---------------------------------------------------------------------------

// Mirror of lib/pois.ts PoiCategory — keep this set identical to the app's.
const POI_CATEGORIES = new Set([
  "tube",
  "rail",
  "bus",
  "river",
  "park",
  "garden",
  "market",
  "historic",
  "viewpoint",
  "sight",
]);

// Greater London bounding box. Coordinates are [lng, lat] to match
// lib/landmarks.ts / lib/pois.ts convention. Kept in lockstep with
// scripts/export_app_dataset_json.py and scripts/build_slim_index.mjs so the
// export, the slim index, and this validator all agree on "in London".
const LON_MIN = -0.55;
const LON_MAX = 0.3;
const LAT_MIN = 51.26;
const LAT_MAX = 51.72;

// A healthy pint dataset is ~3k rows; anything well below that means the export
// truncated. Fail hard so we never ship a gutted map.
const PINT_ROW_FLOOR = 2500;
const SLIM_VENUE_FLOOR = 900;
const DETAIL_VENUE_FLOOR = 900;
const PUBMAXXING_PUB_FLOOR = 150;
const PUBMAXXING_BEVERAGE_ROW_FLOOR = 1400;
const PUBMAXXING_HISTORY_SEED_FLOOR = 70;
const PUBMAXXING_ALCOHOLIC_ROW_FLOOR = 1250;
const PUBMAXXING_NON_ALCOHOLIC_ROW_FLOOR = 100;
const PUBMAXXING_UNKNOWN_ALCOHOLIC_ROW_CEILING = 150;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function inLondon(lng, lat) {
  return lng >= LON_MIN && lng <= LON_MAX && lat >= LAT_MIN && lat <= LAT_MAX;
}

function normaliseVenueKeyPart(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function venueGroupingKey(row) {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join("|");
}

function stableVenueIdFromKey(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function loadJson(name) {
  const path = join(DATA_DIR, name);
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function expectedVenueGroupsFromPintRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLondon(lng, lat)) continue;
    const key = venueGroupingKey(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  const byId = new Map();
  for (const [key, prices] of grouped) {
    byId.set(stableVenueIdFromKey(key), prices);
  }
  return byId;
}

// Collect errors per file so one broken row doesn't hide the rest. We cap the
// number of reported errors so a systemic failure doesn't dump thousands of
// lines, but still count them all.
function makeCollector(limit = 20) {
  const errors = [];
  let total = 0;
  return {
    add(msg) {
      total += 1;
      if (errors.length < limit) errors.push(msg);
    },
    get count() {
      return total;
    },
    report() {
      for (const e of errors) console.log(`    - ${e}`);
      if (total > errors.length) {
        console.log(`    - ...and ${total - errors.length} more`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Validators — each returns { ok, count } and logs its own detail.
// ---------------------------------------------------------------------------

// london_pois.json — mirrors lib/pois.ts isValidPoi, plus id-uniqueness and a
// Greater London bounds check.
function validatePois() {
  const name = "public/data/london_pois.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("london_pois.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (!Array.isArray(data)) {
    console.log(`FAIL ${name}: expected a top-level array`);
    return { ok: false, count: 0 };
  }

  const seenIds = new Set();
  data.forEach((row, i) => {
    const where = `row ${i}`;
    if (typeof row !== "object" || row === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    const id = row.id;
    if (typeof id !== "string" || id.length === 0) {
      errs.add(`${where}: missing/empty id`);
    } else if (seenIds.has(id)) {
      errs.add(`${where}: duplicate id "${id}"`);
    } else {
      seenIds.add(id);
    }
    if (typeof row.name !== "string" || row.name.length === 0) {
      errs.add(`${where} (${id}): missing/empty name`);
    }
    if (!POI_CATEGORIES.has(row.category)) {
      errs.add(`${where} (${id}): invalid category "${row.category}"`);
    }
    const coords = row.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) {
      errs.add(`${where} (${id}): coordinates must be a [lng, lat] pair`);
    } else {
      const [lng, lat] = coords;
      if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) {
        errs.add(`${where} (${id}): non-finite coordinates`);
      } else if (!inLondon(lng, lat)) {
        errs.add(`${where} (${id}): [${lng}, ${lat}] outside Greater London bounds`);
      }
    }
  });

  const ok = errs.count === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${data.length} rows, ${errs.count} error(s)`);
  if (!ok) errs.report();
  return { ok, count: data.length };
}

// tfl_lines.json — a GeoJSON FeatureCollection where each feature carries a line
// name + hex colour and a LineString geometry.
function validateTflLines() {
  const name = "public/data/tfl_lines.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("tfl_lines.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (typeof data !== "object" || data === null || data.type !== "FeatureCollection") {
    console.log(`FAIL ${name}: expected a GeoJSON FeatureCollection`);
    return { ok: false, count: 0 };
  }
  if (!Array.isArray(data.features)) {
    console.log(`FAIL ${name}: features must be an array`);
    return { ok: false, count: 0 };
  }

  data.features.forEach((f, i) => {
    const where = `feature ${i}`;
    if (typeof f !== "object" || f === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    const props = f.properties;
    if (typeof props !== "object" || props === null) {
      errs.add(`${where}: missing properties`);
    } else {
      if (typeof props.line !== "string" || props.line.length === 0) {
        errs.add(`${where}: missing properties.line`);
      }
      if (typeof props.color !== "string" || !HEX_COLOR.test(props.color)) {
        errs.add(`${where}: properties.color "${props.color}" is not a #hex colour`);
      }
    }
    const geom = f.geometry;
    if (typeof geom !== "object" || geom === null || geom.type !== "LineString") {
      errs.add(`${where}: geometry must be a LineString`);
    } else if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) {
      errs.add(`${where}: LineString has no coordinates`);
    }
  });

  const ok = errs.count === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${data.features.length} features, ${errs.count} error(s)`);
  if (!ok) errs.report();
  return { ok, count: data.features.length };
}

// pint_prices_app_dataset.json — the app's core dataset. Sample-check row shape
// (pub_name + numeric-or-null price + finite lat/lng) and FAIL if the row count
// dropped below the sane floor, which catches a truncated export.
function validatePintPrices() {
  const name = "public/data/pint_prices_app_dataset.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("pint_prices_app_dataset.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (!Array.isArray(data)) {
    console.log(`FAIL ${name}: expected a top-level array`);
    return { ok: false, count: 0 };
  }

  const count = data.length;

  // Row-count floor: the primary guard against a truncated dataset.
  if (count < PINT_ROW_FLOOR) {
    errs.add(`row count ${count} is below the floor of ${PINT_ROW_FLOOR} — dataset looks truncated`);
  }

  let outOfBounds = 0;
  data.forEach((row, i) => {
    const where = `row ${i}`;
    if (typeof row !== "object" || row === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    if (typeof row.pub_name !== "string" || row.pub_name.length === 0) {
      errs.add(`${where}: missing/empty pub_name`);
    }
    const price = row.price_gbp;
    if (price !== null && !isFiniteNumber(price)) {
      errs.add(`${where}: price_gbp must be a finite number or null (got ${JSON.stringify(price)})`);
    }
    if (!isFiniteNumber(row.latitude) || !isFiniteNumber(row.longitude)) {
      errs.add(`${where}: latitude/longitude must be finite numbers`);
    } else if (!inLondon(row.longitude, row.latitude)) {
      // Out-of-London coordinates are a data-quality bug the export is meant to
      // strip. Fail the build so a regressed export can't ship scattered pins.
      outOfBounds += 1;
      errs.add(
        `${where} (${row.pub_name}): [${row.longitude}, ${row.latitude}] outside Greater London bounds`,
      );
    }
  });

  if (outOfBounds > 0) {
    console.log(`  ${outOfBounds} row(s) outside Greater London bounds`);
  }

  const ok = errs.count === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${count} rows (floor ${PINT_ROW_FLOOR}), ${errs.count} error(s)`);
  if (!ok) errs.report();
  return { ok, count };
}

// venues_slim.json — the map's first-paint artifact. It must stay byte-aligned
// with the full pint dataset grouping/id seam; otherwise pins can render fast
// but fail when opened for lazy detail. This validator rebuilds the expected
// slim index from the full dataset using the same plain-JS mirror as
// scripts/build_slim_index.mjs.
function validateSlimVenues() {
  const name = "public/data/venues_slim.json";
  const errs = makeCollector();
  let slim;
  let rows;
  try {
    slim = loadJson("venues_slim.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }
  try {
    rows = loadJson("pint_prices_app_dataset.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read full pint dataset for parity check (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (!Array.isArray(slim)) {
    console.log(`FAIL ${name}: expected a top-level array`);
    return { ok: false, count: 0 };
  }
  if (!Array.isArray(rows)) {
    console.log(`FAIL ${name}: expected full pint dataset to be a top-level array`);
    return { ok: false, count: 0 };
  }

  if (slim.length < SLIM_VENUE_FLOOR) {
    errs.add(`venue count ${slim.length} is below the floor of ${SLIM_VENUE_FLOOR} — slim index looks truncated`);
  }

  const grouped = new Map();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLondon(lng, lat)) continue;
    const key = venueGroupingKey(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  const expected = new Map();
  for (const [key, prices] of grouped) {
    const first = prices[0];
    const numericPrices = prices
      .map((p) => p.price_gbp)
      .filter((p) => typeof p === "number" && Number.isFinite(p));
    expected.set(stableVenueIdFromKey(key), {
      name: String(first.pub_name),
      lat: Number(first.latitude),
      lng: Number(first.longitude),
      cheapestPrice: numericPrices.length ? Math.min(...numericPrices) : null,
      borough: String(first.primary_borough || ""),
    });
  }

  if (slim.length !== expected.size) {
    errs.add(`venue count ${slim.length} does not match rebuilt expected count ${expected.size}`);
  }

  const seenIds = new Set();
  slim.forEach((row, i) => {
    const where = `row ${i}`;
    if (typeof row !== "object" || row === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    const id = row.id;
    if (typeof id !== "string" || id.length === 0) {
      errs.add(`${where}: missing/empty id`);
      return;
    }
    if (seenIds.has(id)) {
      errs.add(`${where}: duplicate id "${id}"`);
    } else {
      seenIds.add(id);
    }
    if (typeof row.name !== "string" || row.name.length === 0) {
      errs.add(`${where} (${id}): missing/empty name`);
    }
    if (!isFiniteNumber(row.lat) || !isFiniteNumber(row.lng)) {
      errs.add(`${where} (${id}): lat/lng must be finite numbers`);
    } else if (!inLondon(row.lng, row.lat)) {
      errs.add(`${where} (${id}): [${row.lng}, ${row.lat}] outside Greater London bounds`);
    }
    if (row.cheapestPrice !== null && (!isFiniteNumber(row.cheapestPrice) || row.cheapestPrice < 0)) {
      errs.add(`${where} (${id}): cheapestPrice must be a finite number >= 0 or null`);
    }
    if (typeof row.borough !== "string") {
      errs.add(`${where} (${id}): borough must be a string`);
    }

    const exp = expected.get(id);
    if (!exp) {
      errs.add(`${where} (${id}): id is not present in rebuilt full-dataset index`);
      return;
    }
    if (row.name !== exp.name) {
      errs.add(`${where} (${id}): name "${row.name}" does not match full dataset "${exp.name}"`);
    }
    if (row.lat !== exp.lat || row.lng !== exp.lng) {
      errs.add(`${where} (${id}): coordinates [${row.lng}, ${row.lat}] do not match full dataset [${exp.lng}, ${exp.lat}]`);
    }
    if (row.cheapestPrice !== exp.cheapestPrice) {
      errs.add(`${where} (${id}): cheapestPrice ${row.cheapestPrice} does not match full dataset ${exp.cheapestPrice}`);
    }
    if (row.borough !== exp.borough) {
      errs.add(`${where} (${id}): borough "${row.borough}" does not match full dataset "${exp.borough}"`);
    }
  });

  const ok = errs.count === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${slim.length} venues (floor ${SLIM_VENUE_FLOOR}), ${errs.count} error(s)`);
  if (!ok) errs.report();
  return { ok, count: slim.length };
}

// venue_detail_index.json + venue_details.jsonl — server-side lazy detail
// artifacts generated beside venues_slim.json. The manifest points each venue
// id to a byte range in the JSONL file, so /api/venue/[id] reads only one pub's
// rows instead of parsing/grouping the full pint dataset on cold start.
function validateVenueDetails() {
  const name = "data/generated/venue_details.jsonl";
  const manifestName = "data/generated/venue_detail_index.json";
  const errs = makeCollector();
  let rows;
  try {
    rows = loadJson("pint_prices_app_dataset.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read full pint dataset for parity check (${e.message})`);
    return { ok: false, count: 0 };
  }
  if (!Array.isArray(rows)) {
    console.log(`FAIL ${name}: expected full pint dataset to be a top-level array`);
    return { ok: false, count: 0 };
  }

  const manifestPath = join(GENERATED_DATA_DIR, "venue_detail_index.json");
  const detailsPath = join(GENERATED_DATA_DIR, "venue_details.jsonl");
  if (!existsSync(manifestPath) || !existsSync(detailsPath)) {
    console.log(`FAIL ${name}: generated files are missing; run npm run build:slim`);
    return { ok: false, count: 0 };
  }

  const expectedGroups = expectedVenueGroupsFromPintRows(rows);
  const expectedIds = new Set(expectedGroups.keys());
  const seenIds = new Set();
  let manifest;
  let details;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    details = readFileSync(detailsPath);
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse generated files (${e.message})`);
    return { ok: false, count: 0 };
  }

  const venues = manifest?.venues;
  const entries =
    typeof venues === "object" && venues !== null
      ? Object.entries(venues)
      : [];

  if (manifest?.version !== 1) {
    errs.add(`${manifestName}: version must be 1`);
  }
  if (manifest?.detailsFile !== "venue_details.jsonl") {
    errs.add(`${manifestName}: detailsFile must be "venue_details.jsonl"`);
  }
  if (manifest?.count !== entries.length) {
    errs.add(`${manifestName}: count ${manifest?.count} does not match ${entries.length} manifest entries`);
  }

  if (entries.length < DETAIL_VENUE_FLOOR) {
    errs.add(`venue count ${entries.length} is below the floor of ${DETAIL_VENUE_FLOOR} — detail artifact looks truncated`);
  }
  if (entries.length !== expectedIds.size) {
    errs.add(`venue count ${entries.length} does not match rebuilt expected count ${expectedIds.size}`);
  }

  const spans = [];
  entries.forEach(([id, entry], i) => {
    const where = `entry ${i + 1} (${id})`;
    if (typeof id !== "string" || id.length === 0) {
      errs.add(`entry ${i + 1}: missing/empty id`);
      return;
    }
    if (seenIds.has(id)) {
      errs.add(`${where}: duplicate id`);
    } else {
      seenIds.add(id);
    }
    if (!expectedIds.has(id)) {
      errs.add(`${where}: id is not present in rebuilt full-dataset index`);
    }
    if (typeof entry !== "object" || entry === null) {
      errs.add(`${where}: manifest entry is not an object`);
      return;
    }
    const { offset, length, rowCount } = entry;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      !Number.isSafeInteger(rowCount) ||
      offset < 0 ||
      length <= 0 ||
      rowCount <= 0
    ) {
      errs.add(`${where}: offset, length, and rowCount must be positive safe integers`);
      return;
    }
    if (offset + length > details.length) {
      errs.add(`${where}: byte range ${offset}-${offset + length} exceeds details file length ${details.length}`);
      return;
    }
    spans.push({ id, start: offset, end: offset + length });
    let artifact;
    try {
      artifact = JSON.parse(details.subarray(offset, offset + length).toString("utf8").trim());
    } catch (e) {
      errs.add(`${where}: invalid JSON detail row (${e.message})`);
      return;
    }
    if (typeof artifact !== "object" || artifact === null) {
      errs.add(`${where}: detail row is not an object`);
      return;
    }
    if (artifact.id !== id) {
      errs.add(`${where}: artifact id ${artifact.id} does not match manifest id`);
      return;
    }
    if (!Array.isArray(artifact.rows) || artifact.rows.length === 0) {
      errs.add(`${where}: rows must be a non-empty array`);
      return;
    }
    if (artifact.rows.length !== rowCount) {
      errs.add(`${where}: rowCount ${rowCount} does not match ${artifact.rows.length} detail rows`);
    }
    const expectedRows = expectedGroups.get(id);
    if (expectedRows && artifact.rows.length !== expectedRows.length) {
      errs.add(`${where}: row count ${artifact.rows.length} does not match rebuilt group ${expectedRows.length}`);
    }
    for (const [j, price] of artifact.rows.entries()) {
      if (typeof price !== "object" || price === null) {
        errs.add(`${where} row ${j}: not an object`);
        continue;
      }
      const priceId = stableVenueIdFromKey(venueGroupingKey(price));
      if (priceId !== id) {
        errs.add(`${where} row ${j}: row groups to ${priceId}`);
      }
      if (expectedRows && JSON.stringify(price) !== JSON.stringify(expectedRows[j])) {
        errs.add(`${where} row ${j}: row content does not match the source pint dataset`);
      }
    }
  });

  spans.sort((a, b) => a.start - b.start);
  if (spans.length > 0 && spans[0].start !== 0) {
    errs.add(`${manifestName}: byte ranges start at ${spans[0].start}, expected 0`);
  }
  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i].start < spans[i - 1].end) {
      errs.add(`${manifestName}: byte range for ${spans[i].id} overlaps ${spans[i - 1].id}`);
    } else if (spans[i].start > spans[i - 1].end) {
      errs.add(`${manifestName}: byte range gap before ${spans[i].id}`);
    }
  }
  if (spans.length > 0 && spans[spans.length - 1].end !== details.length) {
    errs.add(`${manifestName}: byte ranges end at ${spans[spans.length - 1].end}, details file has ${details.length} bytes`);
  }

  const missing = Array.from(expectedIds).filter((id) => !seenIds.has(id));
  for (const id of missing.slice(0, 20)) {
    errs.add(`missing detail row for ${id}`);
  }
  if (missing.length > 20) {
    errs.add(`...and ${missing.length - 20} more missing detail rows`);
  }

  const ok = errs.count === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${entries.length} venues (floor ${DETAIL_VENUE_FLOOR}), ${errs.count} error(s)`);
  if (!ok) errs.report();
  return { ok, count: entries.length };
}

// drink_price_updates/*.json — permissible-source drink price update files
// (E2 of docs/PRD_ALL_DRINKS.md). Mirrors lib/drinkPriceUpdates.ts
// isValidDrinkPriceUpdate exactly: a shipped file with even one bad row fails
// CI, because a bad row here means either a broken generator or (worse) an
// un-attributed / stale-presented-as-live price slipping through.
//
// London-bounds are NOT checked here (drink rows carry no lat/lng of their
// own — they key off venueKey, which is validated at merge time against the
// venue dataset instead).
function isHttpUrlLocal(v) {
  if (typeof v !== "string" || v.length === 0) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function validateOneDrinkPriceUpdateFile(fileName) {
  const name = `public/data/drink_price_updates/${fileName}`;
  const errs = makeCollector();
  let data;
  try {
    const raw = readFileSync(join(DRINK_PRICE_UPDATES_DIR, fileName), "utf8");
    data = JSON.parse(raw);
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  const rows = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null && Array.isArray(data.updates)
      ? data.updates
      : null;

  if (rows === null) {
    console.log(`FAIL ${name}: expected a top-level array or a { updates: [...] } envelope`);
    return { ok: false, count: 0 };
  }

  const now = Date.now();
  rows.forEach((row, i) => {
    const where = `row ${i}`;
    if (typeof row !== "object" || row === null) {
      errs.add(`${where}: not an object`);
      return;
    }
    if (typeof row.venueKey !== "string" || row.venueKey.length === 0) {
      errs.add(`${where}: missing/empty venueKey`);
    }
    if (typeof row.drinkName !== "string" || row.drinkName.length === 0) {
      errs.add(`${where}: missing/empty drinkName`);
    }
    if (typeof row.category !== "string" || row.category.length === 0) {
      errs.add(`${where}: missing/empty category`);
    } else if (!DRINK_CATEGORIES.has(row.category)) {
      errs.add(`${where}: invalid category "${row.category}"`);
    }
    if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) {
      errs.add(`${where}: priceGbp must be a finite number >= 0 (got ${JSON.stringify(row.priceGbp)})`);
    }
    const source = row.source;
    if (typeof source !== "object" || source === null) {
      errs.add(`${where}: missing source`);
    } else {
      if (typeof source.label !== "string" || source.label.length === 0) {
        errs.add(`${where}: missing/empty source.label`);
      }
      if (!isHttpUrlLocal(source.url)) {
        errs.add(`${where}: source.url "${source.url}" is not an absolute http(s) URL`);
      }
      // Governance: every fact carries {source, licence, observedAt} — a
      // permissible source is documented with a licence string.
      if (typeof source.licence !== "string" || source.licence.length === 0) {
        errs.add(`${where}: missing/empty source.licence`);
      }
    }
    if (typeof row.observedAt !== "string" || row.observedAt.length === 0) {
      errs.add(`${where}: missing/empty observedAt`);
    } else {
      const ms = Date.parse(row.observedAt);
      if (!Number.isFinite(ms)) {
        errs.add(`${where}: observedAt "${row.observedAt}" is not a valid ISO timestamp`);
      } else if (ms > now) {
        // Never present stale as live — but also never a fabricated FUTURE
        // observation. A price cannot be "observed" before it happened.
        errs.add(`${where}: observedAt "${row.observedAt}" is in the future`);
      }
    }
  });

  const ok = errs.count === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${rows.length} rows, ${errs.count} error(s)`);
  if (!ok) errs.report();
  return { ok, count: rows.length };
}

// Validates every *.json file in public/data/drink_price_updates/ (if the
// directory exists at all — it's optional until E2's refresh script has
// written a real file). Absence of the directory is NOT a failure; a bad file
// inside it IS.
function validateDrinkPriceUpdates() {
  if (!existsSync(DRINK_PRICE_UPDATES_DIR)) {
    console.log("SKIP public/data/drink_price_updates/: directory does not exist");
    return { ok: true, count: 0 };
  }
  const files = readdirSync(DRINK_PRICE_UPDATES_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("SKIP public/data/drink_price_updates/: no .json files present");
    return { ok: true, count: 0 };
  }
  const results = files.map(validateOneDrinkPriceUpdateFile);
  const ok = results.every((r) => r.ok);
  const count = results.reduce((sum, r) => sum + r.count, 0);
  return { ok, count };
}

function isHttpUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validatePubmaxxingSource(data, errs) {
  if (data.version !== 1) {
    errs.add(`version must be 1 (got ${JSON.stringify(data.version)})`);
  }
  if (!data.source || !isHttpUrl(data.source.sourceRepo)) {
    errs.add("source.sourceRepo must be an http(s) URL");
  }
  if (!data.source || typeof data.source.sourceCommit !== "string" || data.source.sourceCommit.length < 7) {
    errs.add("source.sourceCommit must be a git commit-ish string");
  }
  if (!data.source || typeof data.source.importedAt !== "string" || data.source.importedAt.length === 0) {
    errs.add("source.importedAt must be a non-empty string");
  }
  if (typeof data.sourceImportedAt !== "string" || data.sourceImportedAt.length === 0) {
    errs.add("sourceImportedAt must be a non-empty string");
  } else if (data.source?.importedAt && data.sourceImportedAt !== data.source.importedAt) {
    errs.add("sourceImportedAt must match source.importedAt");
  }
}

function validatePubmaxxingSummary(data, rows, errs) {
  const { pubs, beverages, historySeeds, discountMentions } = rows;
  const summary = data.summary && typeof data.summary === "object" ? data.summary : null;
  if (!summary) {
    errs.add("summary must be an object");
  }

  const alcoholicRows = beverages.filter((row) => row?.isAlcoholic === true).length;
  const nonAlcoholicRows = beverages.filter((row) => row?.isAlcoholic === false).length;
  const unknownAlcoholicRows = beverages.filter(
    (row) => row?.isAlcoholic !== true && row?.isAlcoholic !== false,
  ).length;
  const expectedSummary = {
    pubs: pubs.length,
    beverageRows: beverages.length,
    alcoholicRows,
    nonAlcoholicRows,
    unknownAlcoholicRows,
    historySeeds: historySeeds.length,
    discountMentions: discountMentions.length,
    uniquePubIds: new Set(
      [...pubs.map((row) => row?.pubId), ...beverages.map((row) => row?.pubId)].filter(Boolean),
    ).size,
  };
  for (const [field, expected] of Object.entries(expectedSummary)) {
    if (summary?.[field] !== expected) {
      errs.add(`summary.${field} must equal computed count ${expected}`);
    }
  }
  return { alcoholicRows, nonAlcoholicRows, unknownAlcoholicRows };
}

// pubmaxxing_seed_snapshot.json — compact Firecrawl handoff seed from the
// sibling pubmaxxing repo. This data is not yet normalized into canonical live
// venue ids; validate it as an external seed so the all-drinks/history source
// import cannot silently disappear or truncate.
function validatePubmaxxingSeed() {
  const name = "public/data/pubmaxxing_seed_snapshot.json";
  const errs = makeCollector();
  let data;
  try {
    data = loadJson("pubmaxxing_seed_snapshot.json");
  } catch (e) {
    console.log(`FAIL ${name}: could not read/parse (${e.message})`);
    return { ok: false, count: 0 };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    console.log(`FAIL ${name}: expected a top-level object`);
    return { ok: false, count: 0 };
  }

  validatePubmaxxingSource(data, errs);

  const pubs = Array.isArray(data.pubs) ? data.pubs : [];
  const beverages = Array.isArray(data.beverages) ? data.beverages : [];
  const historySeeds = Array.isArray(data.historySeeds) ? data.historySeeds : [];
  const discountMentions = Array.isArray(data.discountMentions) ? data.discountMentions : [];

  if (pubs.length < PUBMAXXING_PUB_FLOOR) {
    errs.add(`pub count ${pubs.length} is below floor ${PUBMAXXING_PUB_FLOOR}`);
  }
  if (beverages.length < PUBMAXXING_BEVERAGE_ROW_FLOOR) {
    errs.add(`beverage row count ${beverages.length} is below floor ${PUBMAXXING_BEVERAGE_ROW_FLOOR}`);
  }
  if (historySeeds.length < PUBMAXXING_HISTORY_SEED_FLOOR) {
    errs.add(`history seed count ${historySeeds.length} is below floor ${PUBMAXXING_HISTORY_SEED_FLOOR}`);
  }

  const { alcoholicRows, nonAlcoholicRows, unknownAlcoholicRows } = validatePubmaxxingSummary(
    data,
    { pubs, beverages, historySeeds, discountMentions },
    errs,
  );
  if (alcoholicRows < PUBMAXXING_ALCOHOLIC_ROW_FLOOR) {
    errs.add(`alcoholic rows ${alcoholicRows} below floor ${PUBMAXXING_ALCOHOLIC_ROW_FLOOR}`);
  }
  if (nonAlcoholicRows < PUBMAXXING_NON_ALCOHOLIC_ROW_FLOOR) {
    errs.add(`non-alcoholic rows ${nonAlcoholicRows} below floor ${PUBMAXXING_NON_ALCOHOLIC_ROW_FLOOR}`);
  }
  if (unknownAlcoholicRows > PUBMAXXING_UNKNOWN_ALCOHOLIC_ROW_CEILING) {
    errs.add(
      `unknown isAlcoholic rows ${unknownAlcoholicRows} above ceiling ${PUBMAXXING_UNKNOWN_ALCOHOLIC_ROW_CEILING}`,
    );
  }

  pubs.forEach((row, i) => {
    if (!row || typeof row.pubId !== "string" || row.pubId.length === 0) {
      errs.add(`pub ${i}: missing pubId`);
    }
    if (!row || typeof row.name !== "string" || row.name.length === 0) {
      errs.add(`pub ${i}: missing name`);
    }
    if (row?.venueUrl && !isHttpUrl(row.venueUrl)) {
      errs.add(`pub ${i}: invalid venueUrl`);
    }
    if (row?.menuUrl && !isHttpUrl(row.menuUrl)) {
      errs.add(`pub ${i}: invalid menuUrl`);
    }
  });

  beverages.forEach((row, i) => {
    if (!row || typeof row.pubId !== "string" || row.pubId.length === 0) {
      errs.add(`beverage ${i}: missing pubId`);
    }
    if (!row || typeof row.name !== "string" || row.name.length === 0) {
      errs.add(`beverage ${i}: missing name`);
    }
    if (!row || typeof row.category !== "string" || row.category.length === 0) {
      errs.add(`beverage ${i}: missing category`);
    }
    if (row?.basePriceGbp !== null && !isFiniteNumber(row?.basePriceGbp)) {
      errs.add(`beverage ${i}: basePriceGbp must be number or null`);
    }
    if (
      row?.isAlcoholic !== true &&
      row?.isAlcoholic !== false &&
      row?.isAlcoholic !== null &&
      row?.isAlcoholic !== undefined
    ) {
      errs.add(`beverage ${i}: isAlcoholic must be boolean, null, or omitted`);
    }
    if (row?.sourceUrl && !isHttpUrl(row.sourceUrl)) {
      errs.add(`beverage ${i}: invalid sourceUrl`);
    }
  });

  historySeeds.forEach((row, i) => {
    if (!row || typeof row.pubId !== "string" || row.pubId.length === 0) {
      errs.add(`history ${i}: missing pubId`);
    }
    if (!row || !isHttpUrl(row.sourceUrl)) {
      errs.add(`history ${i}: invalid sourceUrl`);
    }
  });

  discountMentions.forEach((row, i) => {
    if (!row || typeof row.pubId !== "string" || row.pubId.length === 0) {
      errs.add(`discount ${i}: missing pubId`);
    }
    if (!row || !isHttpUrl(row.sourceUrl)) {
      errs.add(`discount ${i}: invalid sourceUrl`);
    }
  });

  const ok = errs.count === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: ${pubs.length} pubs, ${beverages.length} beverages, ${historySeeds.length} history seeds, ${discountMentions.length} discount mentions, ${errs.count} error(s)`,
  );
  if (!ok) errs.report();
  return { ok, count: beverages.length };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function main() {
  console.log("Validating bundled datasets in public/data …\n");
  const results = [
    validatePois(),
    validateTflLines(),
    validatePintPrices(),
    validateSlimVenues(),
    validateVenueDetails(),
    validateDrinkPriceUpdates(),
    validatePubmaxxingSeed(),
  ];
  const failed = results.filter((r) => !r.ok).length;

  console.log("");
  if (failed > 0) {
    console.log(`DATA VALIDATION FAILED: ${failed} of ${results.length} dataset(s) invalid.`);
    process.exit(1);
  }
  console.log(`DATA VALIDATION PASSED: all ${results.length} datasets valid.`);
}

main();
