// Hand-checked Shoreditch coffee prices. A row is a named drink a page stated,
// with a price and a day. An empty list is a valid file: a drink the page did
// not state stays absent. Nothing here is an estimate, a cheapest-drink figure,
// or a blank "coffee" price.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COFFEE_PILOT_BOX, COFFEE_PILOT_DRINKS } from "./coffeePilotArea.mjs";

export { COFFEE_PILOT_BOX, COFFEE_PILOT_DRINKS, COFFEE_PILOT_FILE } from "./coffeePilotArea.mjs";

const FILE_KEYS = new Set(["version", "area", "checkedOn", "rows"]);
const ROW_KEYS = new Set([
  "venueId",
  "venueName",
  "drink",
  "priceGbp",
  "sourceUrl",
  "observedAt",
  "standing",
]);

function calendarDayMs(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.getTime();
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
 * @param {ReadonlyMap<string, string>} [venueNames] London-layer name for each id
 * @returns {string[]}
 */
export function coffeePilotProblems(file, venueIds, now = Date.now(), venueNames) {
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
  const checkedOn = calendarDayMs(record.checkedOn);
  if (checkedOn === null) problems.push("checkedOn must be a calendar day");
  else if (checkedOn > now) problems.push("checkedOn is in the future");
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
      // `venueNames` holds only cafes inside the box, so a cafe of the same
      // name there is the row's cafe under another OSM id (a node redrawn as a way).
      const replacements = venueNames instanceof Map
        ? [...venueNames].filter(([id, name]) => id !== item.venueId && name === item.venueName).map(([id]) => id)
        : [];
      problems.push(replacements.length > 0
        ? `${where} venueId is not a cafe in the Shoreditch box: ${item.venueName} is now ${replacements.join(" or ")}`
        : `${where} venueId is not a cafe in the Shoreditch box`);
    }
    if (typeof item.venueName !== "string" || item.venueName.trim().length === 0) {
      problems.push(`${where} venueName must name the cafe`);
    } else if (
      venueNames instanceof Map &&
      typeof item.venueId === "string" &&
      venueNames.has(item.venueId) &&
      item.venueName !== venueNames.get(item.venueId)
    ) {
      problems.push(`${where} venueName does not match the cafe on the London layer`);
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
    const observedAt = calendarDayMs(item.observedAt);
    if (observedAt === null) problems.push(`${where} observedAt must be a calendar day`);
    else if (observedAt > now) problems.push(`${where} observedAt is in the future`);
    if (item.standing !== "listed") problems.push(`${where} standing must be listed`);
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
function shoreditchCafes(rootDir) {
  const manifestPath = join(rootDir, "public/data/london_venues/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const prefix = String(manifest.urlPrefix ?? "").replace(/^\//, "");
  /** @type {Map<string, string>} */
  const names = new Map();
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
      const [osmRef, venueName, , lat, lng, kind] = venue;
      if (kind !== "cafe") continue;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (lat < COFFEE_PILOT_BOX.latMin || lat > COFFEE_PILOT_BOX.latMax) continue;
      if (lng < COFFEE_PILOT_BOX.lngMin || lng > COFFEE_PILOT_BOX.lngMax) continue;
      if (typeof osmRef !== "string" || !/^[nwr]\d+$/.test(osmRef)) continue;
      if (typeof venueName !== "string" || venueName.trim().length === 0) continue;
      names.set(`venue-osm-${osmRef}`, venueName);
    }
  }
  return names;
}

/**
 * Cafe id to the name on the London venue layer, inside the pilot box.
 *
 * @param {string} rootDir
 * @returns {Map<string, string>}
 */
export function shoreditchCafeNames(rootDir) {
  return shoreditchCafes(rootDir);
}

/**
 * Cafe ids on the London venue layer inside the pilot box.
 *
 * @param {string} rootDir
 * @returns {Set<string>}
 */
export function shoreditchCafeIds(rootDir) {
  return new Set(shoreditchCafes(rootDir).keys());
}
