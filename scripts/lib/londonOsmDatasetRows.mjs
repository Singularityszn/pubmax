// The one place an OSM pub becomes an UNPRICED row of the London app dataset
// (public/data/pint_prices_app_dataset.json).
//
// Two CLIs add such rows and both must dedupe and stamp them the same way:
// scripts/merge_outer_london_osm.mjs (the Outer London seed pack) and
// scripts/promote_london_osm_pubs.mjs (the bounded UK-base promotion). A rule
// stated twice drifts, so the index, the near-duplicate test and the row shape
// live here.
import { createHash } from "node:crypto";

import {
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
} from "./venueCanonicalization.mjs";

// Greater London safety net (mirrors the export + validate-data bounds).
const LAT_MIN = 51.26;
const LAT_MAX = 51.72;
const LON_MIN = -0.55;
const LON_MAX = 0.3;
// Same tight radius the canonicalize fuzzy pass uses: a matching-ish name this
// close to an existing venue is the same pub.
const NEAR_METERS = 45;

export function inGreaterLondon(lat, lng) {
  return LAT_MIN <= lat && lat <= LAT_MAX && LON_MIN <= lng && lng <= LON_MAX;
}

function normName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Cheap exact key: identical name + 4-dp coords. Only blocks re-adding the very
// same OSM row on a repeat run; the near-duplicate check does the real work.
function venueKey(name, lat, lng) {
  return `${normName(name)}|${Number(lat).toFixed(4)}|${Number(lng).toFixed(4)}`;
}

// The OSM element a merged row was stamped with, from its data_quality_notes.
function stampedOsmId(row) {
  const match = /(?:^|\|)osm_overpass\|([^|]+)/.exec(String(row.data_quality_notes ?? ""));
  return match ? match[1] : null;
}

function nextAppPriceId(existing) {
  let max = 0;
  for (const row of existing) {
    const m = String(row.app_price_id ?? "").match(/app_price_(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * Index the dataset once. `isDuplicate` answers for any OSM pub, and `add`
 * records a pub just appended so a second pub in the same batch cannot repeat it.
 */
export function indexAppDataset(app) {
  const osmIds = new Set(app.map(stampedOsmId).filter(Boolean));
  const keys = new Set(app.map((row) => venueKey(row.pub_name, row.latitude, row.longitude)));
  const venues = app
    .map((row) => ({
      normName: normalizeVenueIdentityName(row.pub_name),
      lat: Number(row.latitude),
      lng: Number(row.longitude),
    }))
    .filter((v) => v.normName && Number.isFinite(v.lat) && Number.isFinite(v.lng));

  return {
    seq: nextAppPriceId(app),
    isDuplicate(osmId, name, lat, lng) {
      if (osmId && osmIds.has(osmId)) return true;
      if (keys.has(venueKey(name, lat, lng))) return true;
      const nn = normalizeVenueIdentityName(name);
      if (!nn) return false;
      return venues.some(
        (v) => haversineMeters(lat, lng, v.lat, v.lng) <= NEAR_METERS && namesLikelySamePub(nn, v.normName),
      );
    },
    add(osmId, name, lat, lng) {
      if (osmId) osmIds.add(osmId);
      keys.add(venueKey(name, lat, lng));
      venues.push({ normName: normalizeVenueIdentityName(name), lat, lng });
    },
  };
}

/**
 * The unpriced dataset row for one OSM pub. `price_gbp: null` renders an honest
 * pin with no price; inventing a price is forbidden. The row names the OSM id,
 * the read time and the licence, so its evidence travels with it.
 */
export function osmDatasetRow({ seq, pub, borough, fetchedAt, attribution, dataset, label }) {
  const lat = Number(pub.lat ?? pub.latitude);
  const lng = Number(pub.lng ?? pub.longitude);
  const name = String(pub.name ?? pub.pub_name ?? "").trim();
  const osmId = String(pub.osmId ?? "");
  const amenity = pub.amenity ? String(pub.amenity) : "pub";
  const key = venueKey(name, lat, lng);
  return {
    app_price_id: `app_price_${String(seq).padStart(6, "0")}`,
    pub_name: name,
    pint_name: "",
    price_gbp: null,
    price_text: "",
    address: pub.address || `${borough}, Greater London`,
    latitude: lat,
    longitude: lng,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: borough,
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    pub_key: createHash("sha1").update(`osm|${osmId}|${key}`).digest("hex").slice(0, 12),
    pint_position_for_pub: "",
    phone_number: pub.phone || "",
    email: "",
    website: pub.website || "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: `${label} OpenStreetMap ${amenity} ${osmId}; fetched ${fetchedAt}. ${attribution}.`,
    food: "",
    cocktails: "",
    beer_garden: pub.outdoorSeating ? "yes" : "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    locality: borough,
    source_datasets: dataset,
    source_row_count: 1,
    visible_borough_source_row_count: 0,
    raw_embedded_source_row_count: 0,
    individual_pub_page_source_row_count: 0,
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: false,
    data_quality_notes: `${dataset}|osm_overpass|${osmId}|sourced`,
    scraped_at_values: fetchedAt,
  };
}

