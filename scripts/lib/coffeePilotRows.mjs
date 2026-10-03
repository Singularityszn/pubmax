// Hand-checked Shoreditch coffee prices. A row is a named drink a page stated,
// with a price and a day. An empty list is a valid file: a drink the page did
// not state stays absent. Nothing here is an estimate, a cheapest-drink figure,
// or a blank "coffee" price.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const COFFEE_PILOT_FILE = "data/coffee_pilot/shoreditch.json";

export const COFFEE_PILOT_DRINKS = ["flat white", "latte", "matcha latte"];

export const COFFEE_PILOT_BOX = {
  latMin: 51.5215,
  latMax: 51.5305,
  lngMin: -0.0835,
  lngMax: -0.0705,
};

const FILE_KEYS = new Set(["version", "area", "checkedOn", "box", "drinks", "rows"]);
const ROW_KEYS = new Set([
  "venueId",
  "venueName",
  "drink",
  "priceGbp",
  "sourceUrl",
  "observedAt",
  "standing",
  "quote",
]);
const BOX_KEYS = ["latMin", "latMax", "lngMin", "lngMax"];

function isCalendarDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
}

function quoteNamesDrink(quote, drink) {
  const text = quote.toLowerCase();
  if (drink === "flat white") return text.includes("flat white");
  if (drink === "matcha latte") return text.includes("matcha latte");
  if (drink === "latte") return /(?<!matcha )\blatte\b(?! art)/.test(text);
  return false;
}

function quoteStatesPrice(quote, priceGbp) {
  const matches = quote.match(/£\s*(\d+(?:\.\d{1,2})?)/g);
  if (!matches) return false;
  return matches.some((match) => {
    const amount = Number(match.replace(/£\s*/, ""));
    return Number.isFinite(amount) && Math.abs(amount - priceGbp) < 0.001;
  });
}

function priceHasAtMostTwoDecimals(priceGbp) {
  const cents = priceGbp * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6;
}

/**
 * Problems with one pilot file. `venueIds` is the set of `venue-osm-` cafe ids
 * inside the Shoreditch box on the London venue layer. An empty `rows` array
 * is not a problem.
 *
 * @param {unknown} file
 * @param {ReadonlySet<string>} venueIds
 * @param {number} [now]
 * @returns {string[]}
 */
export function coffeePilotProblems(file, venueIds, now = Date.now()) {
  /** @type {string[]} */
  const problems = [];
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return ["file must be an object"];
  }
  const record = /** @type {Record<string, unknown>} */ (file);
  for (const key of Object.keys(record)) {
    if (!FILE_KEYS.has(key)) problems.push(`unexpected key ${JSON.stringify(key)}`);
  }
  if (record.version !== 1) problems.push("version must be 1");
  if (record.area !== "shoreditch") problems.push("area must be shoreditch");
  if (!isCalendarDay(record.checkedOn)) problems.push("checkedOn must be a calendar day");
  else if (Date.parse(/** @type {string} */ (record.checkedOn)) > now) {
    problems.push("checkedOn is in the future");
  }
  const box = record.box;
  if (!box || typeof box !== "object" || Array.isArray(box)) {
    problems.push("box must be an object");
  } else {
    const boxRecord = /** @type {Record<string, unknown>} */ (box);
    for (const key of BOX_KEYS) {
      if (boxRecord[key] !== COFFEE_PILOT_BOX[key]) {
        problems.push(`box.${key} must be ${COFFEE_PILOT_BOX[key]}`);
      }
    }
    for (const key of Object.keys(boxRecord)) {
      if (!BOX_KEYS.includes(key)) problems.push(`unexpected box key ${JSON.stringify(key)}`);
    }
  }
  if (!Array.isArray(record.drinks) || record.drinks.length !== COFFEE_PILOT_DRINKS.length ||
      record.drinks.some((drink, index) => drink !== COFFEE_PILOT_DRINKS[index])) {
    problems.push("drinks must be flat white, latte, matcha latte");
  }
  if (!Array.isArray(record.rows)) {
    problems.push("rows must be an array");
    return problems;
  }

  const seen = new Set();
  record.rows.forEach((row, index) => {
    const where = `rows[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      problems.push(`${where} must be an object`);
      return;
    }
    const item = /** @type {Record<string, unknown>} */ (row);
    for (const key of Object.keys(item)) {
      if (!ROW_KEYS.has(key)) problems.push(`${where} unexpected key ${JSON.stringify(key)}`);
    }
    if (typeof item.venueId !== "string" || !/^venue-osm-[nwr]\d+$/.test(item.venueId)) {
      problems.push(`${where} venueId must be a venue-osm- id`);
    } else if (!venueIds.has(item.venueId)) {
      problems.push(`${where} venueId is not a cafe in the Shoreditch box`);
    }
    if (typeof item.venueName !== "string" || item.venueName.trim().length === 0) {
      problems.push(`${where} venueName must name the cafe`);
    }
    if (typeof item.drink !== "string" || !COFFEE_PILOT_DRINKS.includes(item.drink)) {
      problems.push(`${where} drink must be one of the three named drinks`);
    }
    if (typeof item.priceGbp !== "number" || !Number.isFinite(item.priceGbp) || item.priceGbp <= 0) {
      problems.push(`${where} priceGbp must be a price above zero`);
    } else if (!priceHasAtMostTwoDecimals(item.priceGbp)) {
      problems.push(`${where} priceGbp must be in pence`);
    }
    if (typeof item.sourceUrl !== "string") {
      problems.push(`${where} sourceUrl must be the page that stated the price`);
    } else {
      try {
        const url = new URL(item.sourceUrl);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          problems.push(`${where} sourceUrl must be http(s)`);
        }
      } catch {
        problems.push(`${where} sourceUrl must be an absolute URL`);
      }
    }
    if (typeof item.observedAt !== "string" || !Number.isFinite(Date.parse(item.observedAt))) {
      problems.push(`${where} observedAt must be a date`);
    } else if (Date.parse(item.observedAt) > now + 60_000) {
      problems.push(`${where} observedAt is in the future`);
    }
    if (item.standing !== "listed") problems.push(`${where} standing must be listed`);
    if (typeof item.quote !== "string" || item.quote.trim().length === 0) {
      problems.push(`${where} quote must be the line that stated the price`);
    } else if (typeof item.drink === "string" && !quoteNamesDrink(item.quote, item.drink)) {
      problems.push(`${where} quote does not name ${item.drink}`);
    } else if (typeof item.priceGbp === "number" && !quoteStatesPrice(item.quote, item.priceGbp)) {
      problems.push(`${where} quote does not state the price`);
    }
    if (typeof item.venueId === "string" && typeof item.drink === "string") {
      const key = `${item.venueId}\n${item.drink}`;
      if (seen.has(key)) problems.push(`${where} repeats ${item.drink} for ${item.venueId}`);
      seen.add(key);
    }
  });
  return problems;
}

/**
 * Cafe ids on the London venue layer inside the pilot box.
 *
 * @param {string} rootDir
 * @returns {Set<string>}
 */
export function shoreditchCafeIds(rootDir) {
  const manifestPath = join(rootDir, "public/data/london_venues/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const prefix = String(manifest.urlPrefix ?? "").replace(/^\//, "");
  const ids = new Set();
  const shards = Array.isArray(manifest.shards) ? manifest.shards : [];
  for (const shard of shards) {
    const bbox = shard?.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4) continue;
    const [west, south, east, north] = bbox;
    const overlaps = east >= COFFEE_PILOT_BOX.lngMin && west <= COFFEE_PILOT_BOX.lngMax &&
      north >= COFFEE_PILOT_BOX.latMin && south <= COFFEE_PILOT_BOX.latMax;
    if (!overlaps) continue;
    const pack = JSON.parse(readFileSync(join(rootDir, "public", prefix, `${shard.id}.json`), "utf8"));
    const venues = Array.isArray(pack?.venues) ? pack.venues : [];
    for (const venue of venues) {
      if (!Array.isArray(venue) || venue.length < 6) continue;
      const [osmRef, , , lat, lng, kind] = venue;
      if (kind !== "cafe") continue;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (lat < COFFEE_PILOT_BOX.latMin || lat > COFFEE_PILOT_BOX.latMax) continue;
      if (lng < COFFEE_PILOT_BOX.lngMin || lng > COFFEE_PILOT_BOX.lngMax) continue;
      if (typeof osmRef === "string" && /^[nwr]\d+$/.test(osmRef)) ids.add(`venue-osm-${osmRef}`);
    }
  }
  return ids;
}
