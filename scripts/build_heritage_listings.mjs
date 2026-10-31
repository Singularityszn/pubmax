// Build the LISTED-BUILDING heritage dataset from Historic England's open data.
//
// Source: the National Heritage List for England (NHLE) "Listed Building points"
// layer, served from Historic England's ArcGIS open-data hub. Licence: Open
// Government Licence v3.0 (attribution required — see ATTRIBUTION below and the
// credits wired into the app + public/llms.txt). The list entry is the only
// official register of nationally protected buildings in England.
//
// What it does (a deterministic, provenance-honest JOIN):
//   1. Fetch London-bbox listed-building points from the NHLE FeatureServer
//      (paged, WGS84) and commit what was read to data/heritage/
//      nhle_london_points.json, OR rebuild from that committed read (--offline)
//      or another pre-downloaded cache (--cache <path>).
//   2. Load public/data/pint_prices_app_dataset.json, group rows into venues by
//      the SAME key the app uses (venueGroupingKey → stableVenueIdFromKey), so
//      output keys are the exact venue-… ids the map + /api/heritage link by.
//   3. Match conservatively via scripts/lib/heritageMatch.mjs — a listed point
//      must carry the pub's core name AND sit on it. False positives are worse
//      than misses (owner rule), so most pubs get nothing and that is correct.
//   3b. Run the same match for every London OSM pub no curated venue owns,
//      keyed by the `venue-uk-<osmRef>` id its base-layer sheet opens under
//      (scripts/lib/heritageBaseVenues.mjs), so a listed pub off the curated
//      map is not left blank. "Owns" is the published uk_base shards' owner
//      column, the same answer the map uses to hide a base pin.
//   3c. For a curated venue its own name found nothing for, try the OSM name
//      of each base pub it owns, keyed under the curated id.
//   4. Write public/data/heritage_listings.json — ONLY matched pubs, keyed by
//      venueId, with { listEntry, grade, listedYear, name, fact, url, distanceM },
//      plus `$retrievedAt`, the day the NHLE was read, which the sheet prints.
//
// We NEVER invent a grade, an era, or a description. `fact` is grade + the
// building type only when the official listing name names one; `listedYear` is
// the DESIGNATION year (never presented as a construction date). Output is
// key-sorted and pretty-printed with a trailing newline, so re-running with the
// same inputs is byte-identical.
//
// THE READ IS COMMITTED AS EVIDENCE. A routine refresh changes no builder and
// no input, only the NHLE. So a live read also writes the points it read to
// data/heritage/nhle_london_points.json, one sorted row a line, stamped with
// the same `$retrievedAt` as the pack. That file is an input of the
// heritage_listings lane in scripts/check_review_scope.mjs: a refresh carries
// it and passes, and a hand edit of the pack alone is still refused. A
// reviewer re-runs `--offline` and compares.
//
// Run:
//   node scripts/build_heritage_listings.mjs                 # fetch live NHLE
//   node scripts/build_heritage_listings.mjs --offline       # from the committed read
//   node scripts/build_heritage_listings.mjs --cache pts.json --retrieved-at 2026-10-16
//                                                       # from a cache, read that day
//   node scripts/build_heritage_listings.mjs --dry-run       # print, don't write
// Judged pass (requires TYPESAFE_API_KEY; structure Noul + same-pub Noul):
//   node --import tsx scripts/build_heritage_listings.mjs --judged

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDataSourceUrl } from "../lib/harvest/sourcePolicy.ts";
import { baseRowOwners, LONDON_BOX, londonBaseVenues, ownedBaseVenues } from "./lib/heritageBaseVenues.mjs";
import {
  bestMatch,
  buildFactText,
  haversineMeters,
  STRONG_MATCH_M,
  titleCaseName,
} from "./lib/heritageMatch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATASET_PATH = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const OUT_PATH = path.join(ROOT, "public", "data", "heritage_listings.json");
const UK_SEED_PATH = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const UK_BASE_MANIFEST_PATH = path.join(ROOT, "public", "data", "uk_base", "manifest.json");
const NHLE_READ_PATH = path.join(ROOT, "data", "heritage", "nhle_london_points.json");

// The NHLE FeatureServer's row in lib/harvest/sourceRegistry.ts. THE TABLE OWNS
// THE HOST: the query URL comes from `openDataSourceUrl`, never from here.
const NHLE_SOURCE_POLICY_ID = "historic-england-nhle";

// Greater-London bounding box (WGS84). Generous; the matcher's distance gate is
// what actually prevents cross-region false positives.
const LONDON_BBOX = { xmin: -0.55, ymin: 51.28, xmax: 0.34, ymax: 51.7 };

export const ATTRIBUTION =
  "Listed-building data from Historic England's National Heritage List for " +
  "England (NHLE), © Historic England, licensed under the Open Government " +
  "Licence v3.0.";

const LIST_ENTRY_URL = (listEntry) =>
  `https://historicengland.org.uk/listing/the-list/list-entry/${listEntry}`;

// --- venue keying: an exact mirror of lib/venues.ts (kept plain like the other
// scripts/*.mjs generators so this has no TS import gymnastics) -----------------
function normaliseVenueKeyPart(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
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

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

// The published uk_base shards whose cell meets the London box.
async function londonBaseShards() {
  const manifest = await loadJson(UK_BASE_MANIFEST_PATH);
  const prefix = String(manifest.urlPrefix ?? "").replace(/^\/+/, "");
  const cells = (manifest.shards ?? []).filter(({ bbox: [minLng, minLat, maxLng, maxLat] = [] }) =>
    minLng < LONDON_BOX.maxLng && maxLng > LONDON_BOX.minLng && minLat < LONDON_BOX.maxLat && maxLat > LONDON_BOX.minLat,
  );
  return Promise.all(cells.map(({ id }) => loadJson(path.join(ROOT, "public", prefix, `${id}.json`))));
}

// One representative venue per grouping key (first row supplies name/coords),
// exactly as groupVenuePrices() does in the app.
function groupVenues(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!Number.isFinite(Number(row.latitude)) || !Number.isFinite(Number(row.longitude))) {
      continue;
    }
    const key = venueGroupingKey(row);
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: stableVenueIdFromKey(key),
        name: row.pub_name,
        lat: Number(row.latitude),
        lng: Number(row.longitude),
      });
    }
  }
  return [...byKey.values()];
}

// Fetch every London-bbox listed-building point, paged at the service max.
async function fetchListedPoints() {
  const points = [];
  const step = 1000;
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: "1=1",
      geometry: JSON.stringify({ ...LONDON_BBOX, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "ListEntry,Name,Grade,ListDate",
      outSR: "4326",
      resultOffset: String(offset),
      resultRecordCount: String(step),
      f: "json",
    });
    const url = openDataSourceUrl(NHLE_SOURCE_POLICY_ID, `?${params.toString()}`);
    const res = await fetch(url.href, { redirect: "error" });
    if (!res.ok) throw new Error(`NHLE fetch failed: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`NHLE error: ${JSON.stringify(body.error)}`);
    const features = body.features ?? [];
    for (const feature of features) {
      const point = feature.geometry?.points?.[0];
      if (!point) continue;
      points.push({
        listEntry: feature.attributes.ListEntry,
        name: feature.attributes.Name,
        grade: feature.attributes.Grade,
        listDate: feature.attributes.ListDate,
        lat: point[1],
        lng: point[0],
      });
    }
    process.stderr.write(`  fetched offset ${offset} (+${features.length})\n`);
    if (features.length < step) break;
    offset += step;
  }
  return points;
}

// Coarse spatial index: 0.003° cells (~330 m) so a 3×3 neighbourhood always
// covers the matcher's ≤120 m gate. Turns an O(pubs×listings) scan into a
// near-linear one without changing which match the pure matcher would pick.
const CELL = 0.003;
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

function indexPoints(points) {
  const grid = new Map();
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const key = cellKey(point.lat, point.lng);
    const bucket = grid.get(key);
    if (bucket) bucket.push(point);
    else grid.set(key, [point]);
  }
  return grid;
}

function candidatesFor(grid, lat, lng) {
  const baseLat = Math.floor(lat / CELL);
  const baseLng = Math.floor(lng / CELL);
  const out = [];
  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLng = -1; dLng <= 1; dLng += 1) {
      const bucket = grid.get(`${baseLat + dLat}:${baseLng + dLng}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

function listedYearOf(listDate) {
  if (typeof listDate !== "number") return null;
  const year = new Date(listDate).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

// A curated venue whose kept name no longer carries the listing's core name,
// so the name matcher cannot find a listing it found before. Each one is a
// duplicate pair canonicalize:venues merged on 17 Oct 2026 (commit 7b19ec84,
// VERIFIED_VENUE_ALIASES in scripts/lib/venueCanonicalization.mjs): the
// merged-away record carried the official name and matched, and the record
// kept carries the street address and a shorter or misspelt name. The pin
// names the list entry only. Grade, name and year still come from the NHLE
// read, and the point must still sit within STRONG_MATCH_M of the venue.
export const VERIFIED_LISTINGS = Object.freeze({
  "venue-168ndjw": 1079501, // Crown & Horseshoe, EN2 <- Crown & Horseshoes
  "venue-1lj3hj4": 1078950, // The Trafalgar, Park Row SE10 <- Trafalgar Tavern
  "venue-1xmac": 1065528, // The Grapes SW18 <- The Grapes
  "venue-698bu3": 1267004, // The Old Spades, 37 Whitehall <- The Old Shades
  "venue-68ns7y": 1078281, // Ye Old Mitre, EC1N 6SJ <- Ye Olde Mitre
});

function verifiedMatch(venue, candidates) {
  const listEntry = VERIFIED_LISTINGS[venue.id];
  if (listEntry === undefined) return null;
  const listing = candidates.find((point) => Number(point.listEntry) === listEntry);
  if (!listing) return null;
  const distanceM = haversineMeters(venue.lat, venue.lng, listing.lat, listing.lng);
  return distanceM <= STRONG_MATCH_M ? { listing, distanceM } : null;
}

// `ownedBase` (ownedBaseVenues) is tried after every venue, and only for an id
// that has no listing yet, so a curated venue's own name always wins.
export function buildListings(venues, points, { ownedBase = [] } = {}) {
  const grid = indexPoints(points);
  const listings = {};
  for (const venue of [...venues, ...ownedBase]) {
    if (listings[venue.id]) continue;
    const candidates = candidatesFor(grid, venue.lat, venue.lng);
    const match = bestMatch(venue, candidates) ?? verifiedMatch(venue, candidates);
    if (!match) continue;
    const { listing, distanceM } = match;
    const fact = buildFactText(listing.grade, listing.name);
    if (!fact) continue;
    listings[venue.id] = {
      listEntry: listing.listEntry,
      grade: String(listing.grade).trim(),
      listedYear: listedYearOf(listing.listDate),
      name: titleCaseName(listing.name),
      fact,
      url: LIST_ENTRY_URL(listing.listEntry),
      distanceM: Math.round(distanceM),
    };
  }
  return listings;
}

export function serialise(listings, retrievedAt) {
  if (!Number.isFinite(Date.parse(retrievedAt))) {
    throw new Error("The NHLE read needs the day it was read (--retrieved-at for a cache).");
  }
  const sortedKeys = Object.keys(listings).sort();
  const ordered = {};
  for (const key of sortedKeys) ordered[key] = listings[key];
  const doc = {
    $attribution: ATTRIBUTION,
    $source: "Historic England — National Heritage List for England (NHLE), Listed Building points",
    $licence: "Open Government Licence v3.0",
    $retrievedAt: retrievedAt,
    listings: ordered,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * The committed NHLE read: one `[listEntry, name, grade, listDate, lat, lng]`
 * row a line, sorted by list entry, so a refresh diffs as the listings that
 * moved.
 */
export function serialiseRead(points, retrievedAt) {
  if (!Number.isFinite(Date.parse(retrievedAt))) {
    throw new Error("The NHLE read needs the day it was read.");
  }
  const rows = points
    .map((p) => [p.listEntry, p.name, p.grade, p.listDate ?? null, p.lat, p.lng])
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const head = {
    $attribution: ATTRIBUTION,
    $source: "Historic England — National Heritage List for England (NHLE), Listed Building points, Greater London box",
    $licence: "Open Government Licence v3.0",
    $retrievedAt: retrievedAt,
    $columns: ["listEntry", "name", "grade", "listDate", "lat", "lng"],
  };
  const headLines = Object.entries(head).map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
  );
  const body = rows.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  return `{\n${headLines.join("\n")}\n  "points": [\n${body}\n  ]\n}\n`;
}

/**
 * Points from a cache: the committed read (`{ $retrievedAt, points: rows }`)
 * or a bare array of `{ listEntry, name, grade, listDate, lat, lng }`.
 */
export function parseRead(doc) {
  if (Array.isArray(doc)) {
    return {
      retrievedAt: null,
      points: doc.map((p) => ({
        listEntry: p.listEntry,
        name: p.name,
        grade: p.grade,
        listDate: p.listDate,
        lat: p.lat,
        lng: p.lng,
      })),
    };
  }
  const rows = Array.isArray(doc?.points) ? doc.points : [];
  return {
    retrievedAt: typeof doc?.$retrievedAt === "string" ? doc.$retrievedAt : null,
    points: rows.map(([listEntry, name, grade, listDate, lat, lng]) => ({
      listEntry,
      name,
      grade,
      listDate,
      lat,
      lng,
    })),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const cacheIdx = argv.indexOf("--cache");
  const cachePath = cacheIdx !== -1 ? argv[cacheIdx + 1] : null;

  const dataset = await loadJson(DATASET_PATH);
  const rows = Array.isArray(dataset) ? dataset : dataset.venues ?? [];
  const curated = groupVenues(rows);
  // A base row the map hides behind one of these curated venues is matched
  // under the curated id alone. An owner this join does not match keeps its
  // base pub, so no listing is lost to an owner the pack never keys.
  const curatedIds = new Set(curated.map((venue) => venue.id));
  const ownedBy = new Map(
    [...baseRowOwners(await londonBaseShards())].filter(([, owner]) => curatedIds.has(owner)),
  );
  const seedPubs = (await loadJson(UK_SEED_PATH)).pubs;
  const base = londonBaseVenues(seedPubs, { ownedBy });
  const ownedBase = ownedBaseVenues(seedPubs, { ownedBy });
  const venues = [...curated, ...base];
  process.stderr.write(
    `Grouped ${rows.length} rows into ${curated.length} venues, plus ${base.length} London base pubs ` +
      `(${ownedBy.size} base rows owned by a curated venue).\n`,
  );

  // The day the NHLE was read. A live read is today; a cache states its own,
  // in its `$retrievedAt` or with --retrieved-at.
  const offline = argv.includes("--offline");
  const readPath = offline ? NHLE_READ_PATH : cachePath ? path.resolve(cachePath) : null;
  const retrievedIdx = argv.indexOf("--retrieved-at");
  const statedDay = retrievedIdx === -1 ? "" : (argv[retrievedIdx + 1] ?? "");

  let points;
  let retrievedAt;
  if (readPath) {
    process.stderr.write(`Reading NHLE points from ${path.relative(ROOT, readPath)}\n`);
    const read = parseRead(await loadJson(readPath));
    points = read.points;
    const day = statedDay || read.retrievedAt || "";
    retrievedAt = Number.isFinite(Date.parse(day)) ? new Date(day).toISOString() : "";
    if (!retrievedAt) throw new Error("A cached NHLE read needs --retrieved-at <the day it was read>.");
  } else {
    process.stderr.write("Fetching NHLE London listed-building points...\n");
    retrievedAt = new Date().toISOString();
    points = await fetchListedPoints();
  }
  process.stderr.write(`Have ${points.length} listed-building points.\n`);

  const judged = argv.includes("--judged");
  let listings;
  if (judged) {
    const { typesafeConfigured, requiresHeritageStructureKeyMessage } = await import(
      "../lib/heritageListingStructure.ts"
    );
    const { judgedBestMatch } = await import("./lib/heritageJudgedMatch.ts");
    const { writeSamePubReviewFile } = await import("./lib/samePubJudgedCanonicalize.ts");
    if (!typesafeConfigured()) {
      process.stderr.write(`${requiresHeritageStructureKeyMessage()}\n`);
      process.exit(1);
    }
    listings = {};
    const review = [];
    const grid = indexPoints(points);
    for (const venue of [...venues, ...ownedBase]) {
      if (listings[venue.id]) continue;
      const candidates = candidatesFor(grid, venue.lat, venue.lng);
      const judgedResult = await judgedBestMatch(venue, candidates);
      review.push(...judgedResult.review);
      const match = judgedResult.match?.listing ? judgedResult.match : verifiedMatch(venue, candidates);
      if (!match?.listing) continue;
      const fact = buildFactText(match.listing.grade, match.listing.name);
      if (!fact) continue;
      listings[venue.id] = {
        listEntry: match.listing.listEntry,
        grade: String(match.listing.grade).trim(),
        listedYear: listedYearOf(match.listing.listDate),
        name: titleCaseName(match.listing.name),
        fact,
        url: LIST_ENTRY_URL(match.listing.listEntry),
        distanceM: Math.round(match.distanceM),
      };
    }
    const reviewPath = await writeSamePubReviewFile(
      review,
      ROOT,
      "data/review/heritage-listing-review.json",
      "NHLE listing pairs in the uncertain band between the refuse and merge thresholds. Never auto-merged.",
    );
    process.stderr.write(
      `heritage listings: judged pass wrote ${review.length} review-band pair(s) to ${reviewPath}\n`,
    );
  } else {
    listings = buildListings(venues, points, { ownedBase });
  }
  const matched = Object.keys(listings).length;
  process.stderr.write(`Matched ${matched} pubs to listed buildings.\n`);

  const output = serialise(listings, retrievedAt);
  if (dryRun) {
    process.stdout.write(output);
    return;
  }
  if (!readPath) {
    await mkdir(path.dirname(NHLE_READ_PATH), { recursive: true });
    await writeFile(NHLE_READ_PATH, serialiseRead(points, retrievedAt));
    process.stderr.write(`Wrote ${path.relative(ROOT, NHLE_READ_PATH)} (${points.length} points).\n`);
  }
  await writeFile(OUT_PATH, output);
  process.stderr.write(`Wrote ${path.relative(ROOT, OUT_PATH)} (${matched} listed pubs).\n`);
}

// Run only as a script, not when imported by the test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`build_heritage_listings failed: ${error.message}\n`);
    process.exit(1);
  });
}
