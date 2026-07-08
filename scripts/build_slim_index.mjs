// Build the SLIM venue index the map needs to render pins + labels + price
// colour, WITHOUT shipping the ~6 MB raw price dataset to every visitor.
//
// The map only needs, per venue: a stable id (to deep-link + fetch heavy detail
// on open), name, lat/lng, the cheapest numeric price (for the label + colour),
// and a borough. This script groups the raw rows the SAME way
// lib/venues.ts#groupVenuePrices does — same FNV-1a stable id, same grouping
// key — so every slim id is byte-identical to the "venue-…" id the rest of the
// app links by. The heavy detail (all prices, amenities, curation) is fetched
// lazily per-id via /api/venue/[id].
//
// Run once at build/refresh:  node scripts/build_slim_index.mjs
//
// The grouping/id logic below is a plain-JS MIRROR of lib/venues.ts (importing
// TS from a .mjs is awkward); __tests__/venuesSlim.test.ts asserts a sample of
// the ids this produces equals stableVenueIdFromKey(venueGroupingKey(...)) from
// the real TS, so the mirror can never silently drift.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const GENERATED_DIR = path.join(ROOT, "data", "generated");
const DETAIL_INDEX_PATH = path.join(GENERATED_DIR, "venue_detail_index.json");
const DETAIL_ROWS_PATH = path.join(GENERATED_DIR, "venue_details.jsonl");

// Greater London bounding box — a safety net mirroring
// scripts/export_app_dataset_json.py and scripts/validate-data.mjs. The export
// already drops out-of-bounds rows; this guards the slim index against any that
// slip through a hand-edited JSON.
const LAT_MIN = 51.26;
const LAT_MAX = 51.72;
const LON_MIN = -0.55;
const LON_MAX = 0.3;

function inLondon(lat, lng) {
  return lat >= LAT_MIN && lat <= LAT_MAX && lng >= LON_MIN && lng <= LON_MAX;
}

// --- mirror of lib/venues.ts grouping + id logic (keep in lockstep) ----------

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

// --- filter hint helpers ------------------------------------------------------

function truthyFlag(value) {
  return ["yes", "true", "y", "1"].includes(String(value ?? "").trim().toLowerCase());
}

const NA_BRANDS = [
  "lucky saint",
  "nanny state",
  "big drop",
  "mash gang",
  "days brewing",
  "beck's blue",
  "becks blue",
  "free damm",
  "erdinger alkoholfrei",
  "infinite session",
  "impossibrew",
  "st peter's without",
];

const NA_PATTERNS = [
  /alcohol[\s-]?free/i,
  /non[\s-]?alcoholic/i,
  /\balcohol[\s-]?free\b/i,
  /\b0[.,]0\b/,
  /\b0[.,]5\s*%/,
  /\b0\s*%/,
  /\bAF\b/,
  /(guinness|heineken|peroni|san miguel|corona|stella|birra moretti|estrella|madri|asahi)\s*0/i,
];

function isNonAlcoholicDrinkName(name) {
  const raw = String(name ?? "");
  const lower = raw.toLowerCase();
  if (!lower.trim()) return false;
  if (NA_BRANDS.some((brand) => lower.includes(brand))) return true;
  return NA_PATTERNS.some((pattern) => pattern.test(raw));
}

const WATER_TERMS = [
  "riverside",
  "river",
  "thames",
  "strand-on-the-green",
  "strand on the green",
  "wapping wall",
  "narrow st",
  "narrow street",
  "upper mall",
  "wharf",
  "dock",
  "canal",
  "waterside",
];

const HERITAGE_TERMS = [
  "victorian",
  "georgian",
  "edwardian",
  "tudor",
  "grade ii listed",
  "grade i listed",
  "oldest pub",
  "dating back",
  "since 18",
  "since 17",
  "since 16",
];

// Mirrors the curated names in lib/curation.ts. Keep this compact: the slim
// artifact only needs the derived filter booleans, not the display copy.
const CURATED_VENUES = {
  "prospect of whitby": { nearWater: true, hasHeritage: true },
  "the grapes": { nearWater: true, hasHeritage: true },
  "the dove": { nearWater: true, hasHeritage: true },
  "the old pack horse": { hasHeritage: true },
  "the lamb": { hasHeritage: true },
  "the sun tavern": { hasHeritage: true },
  "the queens head": { hasHeritage: true },
  "the queens arms": { hasHeritage: true },
};

function normaliseVenueName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildCurationHints(prices) {
  const sortedPrices = [...prices].sort((a, b) => {
    const left = a.price_gbp ?? Number.POSITIVE_INFINITY;
    const right = b.price_gbp ?? Number.POSITIVE_INFINITY;
    return left - right;
  });
  const first = sortedPrices[0] ?? prices[0];
  const explicit = CURATED_VENUES[normaliseVenueName(first.pub_name)] ?? {};
  const haystack = [
    first.pub_name,
    first.address,
    first.description,
    ...prices.map((price) => price.comment),
  ]
    .join(" ")
    .toLowerCase();
  const inferredHeritage =
    explicit.hasHeritage !== true && HERITAGE_TERMS.some((term) => haystack.includes(term));

  return {
    nearWater: explicit.nearWater ?? WATER_TERMS.some((term) => haystack.includes(term)),
    hasStory: explicit.hasHeritage === true || inferredHeritage,
  };
}

function buildFilterHints(prices) {
  const first = prices[0];
  const searchParts = new Set(
    [
      first.pub_name,
      first.address,
      first.primary_borough,
      first.boroughs_visible,
      ...prices.map((price) => price.pint_name),
    ]
      .map((part) => String(part ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const curation = buildCurationHints(prices);

  return {
    searchText: Array.from(searchParts).join(" "),
    amenities: {
      food: prices.some((price) => truthyFlag(price.food)),
      cocktails: prices.some((price) => truthyFlag(price.cocktails)),
      beerGarden: prices.some((price) => truthyFlag(price.beer_garden)),
      liveSports: prices.some((price) => truthyFlag(price.live_sports)),
      nonAlcoholic: prices.some((price) => isNonAlcoholicDrinkName(price.pint_name)),
    },
    curation,
    canonical: prices.some((price) => price.is_clean_canonical_app_row === true),
  };
}

// --- build -------------------------------------------------------------------

async function main() {
  const rawText = await readFile(RAW_PATH, "utf8");
  const rows = JSON.parse(rawText);
  if (!Array.isArray(rows)) {
    throw new Error(`Expected an array in ${RAW_PATH}, got ${typeof rows}`);
  }

  // Group rows by the canonical key. Preserve first-seen order so the first row
  // of a group supplies name/lat/lng/borough — matching groupVenuePrices, whose
  // Map preserves insertion order and reads name/coords/borough off `first`
  // (the first row inserted, not the price-sorted first).
  const grouped = new Map();
  let droppedOob = 0;
  for (const row of rows) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inLondon(lat, lng)) {
      droppedOob += 1;
      continue;
    }
    const key = venueGroupingKey(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  if (droppedOob > 0) {
    console.log(`dropped ${droppedOob} row(s) outside Greater London bounds`);
  }

  const slim = [];
  const detailLines = [];
  const detailIndex = {
    version: 1,
    detailsFile: "venue_details.jsonl",
    count: 0,
    venues: {},
  };
  let detailOffset = 0;
  for (const [key, prices] of grouped) {
    const first = prices[0];
    const numericPrices = prices
      .map((p) => p.price_gbp)
      .filter((p) => typeof p === "number" && Number.isFinite(p));
    const cheapestPrice = numericPrices.length ? Math.min(...numericPrices) : null;
    const id = stableVenueIdFromKey(key);

    slim.push({
      id,
      name: String(first.pub_name),
      lat: Number(first.latitude),
      lng: Number(first.longitude),
      cheapestPrice,
      borough: String(first.primary_borough || ""),
      filterHints: buildFilterHints(prices),
    });

    const detailLine = `${JSON.stringify({ id, rows: prices })}\n`;
    const detailLength = Buffer.byteLength(detailLine);
    detailIndex.venues[id] = {
      offset: detailOffset,
      length: detailLength,
      rowCount: prices.length,
    };
    detailOffset += detailLength;
    detailLines.push(detailLine);
  }
  detailIndex.count = detailLines.length;

  // Compact JSON (no whitespace) — the map never reads this file by hand.
  const slimText = JSON.stringify(slim);
  const detailText = detailLines.join("");
  const detailIndexText = JSON.stringify(detailIndex);
  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(SLIM_PATH, slimText);
  await writeFile(DETAIL_ROWS_PATH, detailText);
  await writeFile(DETAIL_INDEX_PATH, detailIndexText);

  const rawBytes = Buffer.byteLength(rawText);
  const slimBytes = Buffer.byteLength(slimText);
  const detailBytes = Buffer.byteLength(detailText);
  const kb = (bytes) => (bytes / 1024).toFixed(1);
  const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

  console.log(`raw:   ${rows.length} price rows   ${mb(rawBytes)} MB (${rawBytes} bytes)`);
  console.log(`slim:  ${slim.length} venues       ${kb(slimBytes)} KB (${slimBytes} bytes)`);
  console.log(
    `saved: ${mb(rawBytes - slimBytes)} MB   (slim is ${(100 - (slimBytes / rawBytes) * 100).toFixed(1)}% smaller)`,
  );
  console.log(`wrote: ${path.relative(ROOT, SLIM_PATH)}`);
  console.log(`detail rows: ${slim.length} venues ${mb(detailBytes)} MB (${detailBytes} bytes)`);
  console.log(`wrote: ${path.relative(ROOT, DETAIL_ROWS_PATH)}`);
  console.log(`wrote: ${path.relative(ROOT, DETAIL_INDEX_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
