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
const DATA_DIR = join(__dirname, "..", "public", "data");
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

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function inLondon(lng, lat) {
  return lng >= LON_MIN && lng <= LON_MAX && lat >= LAT_MIN && lat <= LAT_MAX;
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function loadJson(name) {
  const path = join(DATA_DIR, name);
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
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

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function main() {
  console.log("Validating bundled datasets in public/data …\n");
  const results = [validatePois(), validateTflLines(), validatePintPrices(), validateDrinkPriceUpdates()];
  const failed = results.filter((r) => !r.ok).length;

  console.log("");
  if (failed > 0) {
    console.log(`DATA VALIDATION FAILED: ${failed} of ${results.length} dataset(s) invalid.`);
    process.exit(1);
  }
  console.log(`DATA VALIDATION PASSED: all ${results.length} datasets valid.`);
}

main();
