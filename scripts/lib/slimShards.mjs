// Shared, dependency-free shard-plan logic for the SLIM venue index.
//
// #315 (`data/outer-london-osm`) grew venues_slim.json to ~805 KB by adding
// ~650 sourced Outer-London OSM venue-PRESENCE pins across the ten "hollow"
// boroughs the persona-coverage audit flagged (Barking & Dagenham, Brent,
// Enfield, Greenwich, Haringey, Hounslow, Kingston upon Thames, Newham, Sutton,
// Waltham Forest). Those pins are overwhelmingly UNPRICED (OSM presence only),
// so they dominate payload while contributing almost no priced density — the
// map's first paint pays ~290 KB for boroughs a given session rarely looks at.
//
// This module partitions the slim rows into:
//   • a CORE shard — every borough with real priced density (the pre-#315
//     inner-London index) — shipped eagerly on first paint;
//   • one LAZY shard per hollow outer borough — fetched on demand when the map
//     viewport intersects its bbox, near-me geolocates into it, or a consumer
//     asks for the whole index.
// A tiny manifest (shard -> bbox + url) ships eagerly alongside core.
//
// The classification is OBJECTIVE and data-driven (priced-venue ratio), not a
// hard-coded borough list, so a borough that gains real price coverage in a
// future refresh graduates into core automatically. The build script enforces
// that core still fits the eager budget, so a data drift that would blow the
// budget fails CI rather than silently regressing first paint.

// A borough is a LAZY outer shard when it is dominated by unpriced presence
// pins (low priced ratio) AND carries enough of them to be worth deferring.
// Today the ten #315 boroughs sit at 4–17% priced; the leanest CORE borough
// (Richmond) is 62% — a wide, safe gap around this 40% threshold.
export const OUTER_MAX_PRICED_RATIO = 0.4;
export const OUTER_MIN_VENUES = 20;

export const MANIFEST_FILE = "venues_slim.manifest.json";
export const CORE_FILE = "venues_slim.core.json";
export const SHARD_VERSION = 1;

/** Public URL path (what the client fetches) for a data filename. */
export function dataUrl(fileName) {
  return `/data/${fileName}`;
}

/** File-safe borough slug, matching the OSM raw-file naming (barking_and_dagenham). */
export function slugifyBorough(borough) {
  return String(borough ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function shardFileForSlug(slug) {
  return `venues_slim.${slug}.json`;
}

function pricedRatio(venues) {
  if (venues.length === 0) return 1;
  const priced = venues.filter(
    (v) => typeof v.cheapestPrice === "number" && Number.isFinite(v.cheapestPrice),
  ).length;
  return priced / venues.length;
}

/** [minLng, minLat, maxLng, maxLat] over a venue list (GeoJSON bbox order). */
export function computeBbox(venues) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const v of venues) {
    const lat = Number(v.lat);
    const lng = Number(v.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  if (minLng === Infinity) return [0, 0, 0, 0];
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Partition slim rows into a core list + one outer shard per hollow borough.
 * A borough qualifies as outer iff it has >= OUTER_MIN_VENUES rows AND its
 * priced ratio is < OUTER_MAX_PRICED_RATIO. Every other row (including tiny /
 * ambiguous borough labels) stays in core, where it is always available.
 *
 * Returns { core, outer } where outer is a Map<slug, { borough, venues }>
 * ordered by descending venue count (stable, deterministic output).
 */
export function classifySlimShards(slim) {
  const byBorough = new Map();
  for (const v of slim) {
    const borough = String(v.borough ?? "");
    const bucket = byBorough.get(borough);
    if (bucket) bucket.push(v);
    else byBorough.set(borough, [v]);
  }

  const outer = new Map();
  const core = [];
  const outerBoroughs = new Set();
  for (const [borough, venues] of byBorough) {
    const slug = slugifyBorough(borough);
    if (
      slug &&
      venues.length >= OUTER_MIN_VENUES &&
      pricedRatio(venues) < OUTER_MAX_PRICED_RATIO
    ) {
      outerBoroughs.add(borough);
    }
  }

  // Preserve original slim order within each shard so ids stay comparable.
  for (const v of slim) {
    const borough = String(v.borough ?? "");
    if (outerBoroughs.has(borough)) {
      const slug = slugifyBorough(borough);
      const bucket = outer.get(slug);
      if (bucket) bucket.venues.push(v);
      else outer.set(slug, { borough, venues: [v] });
    } else {
      core.push(v);
    }
  }

  // Deterministic shard order: descending venue count, then slug.
  const ordered = new Map(
    [...outer.entries()].sort((a, b) => {
      const d = b[1].venues.length - a[1].venues.length;
      return d !== 0 ? d : a[0].localeCompare(b[0]);
    }),
  );

  return { core, outer: ordered };
}

/**
 * Build the eager manifest. `shards` lists both the core shard (core:true) and
 * every outer shard, each with an { id, url, bbox, count } so the client can
 * resolve a viewport / point to the shards it must fetch without downloading
 * any shard body first.
 */
export function buildShardManifest({ core, outer }) {
  const shards = [
    {
      id: "core",
      core: true,
      url: dataUrl(CORE_FILE),
      count: core.length,
      bbox: computeBbox(core),
    },
  ];
  for (const [slug, { borough, venues }] of outer) {
    shards.push({
      id: slug,
      core: false,
      borough,
      url: dataUrl(shardFileForSlug(slug)),
      count: venues.length,
      bbox: computeBbox(venues),
    });
  }
  return { version: SHARD_VERSION, shards };
}
