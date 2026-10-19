/**
 * Who owns a menu page, and is the pub a harvester matched that owner?
 *
 * A pub's own website is stated in two places we already hold: the OSM
 * `website` tag and the Google Places `websiteUri`. Both are placed by the OSM
 * point of that pub. A menu page whose owner sits more than
 * MENU_OWNER_MAX_METRES from the matched pub is another pub's menu, however well
 * the names agree: the Golden Lion in Dean Street once wore the St James's Golden
 * Lion's whole menu because the two share a name.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { haversineMeters } from "./geo.mjs";

export const MENU_OWNER_MAX_METRES = 150;

const OSM_PUBS_PATH = join("data", "osm", "uk", "uk_osm_pubs.json");
const PLACES_PATH = join("data", "places_enrichment.json");
const OSM_TYPE_BY_PREFIX = { n: "node", w: "way", r: "relation" };

/** Host and path of a pub page, without `www.`, query, a trailing `/menu` or slash. */
export function menuPageKey(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname
      .toLowerCase()
      .replace(/\/+$/, "")
      .replace(/\/menu$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/** The point a `name|address|lat|lng` venue key carries. */
export function venueKeyPoint(venueKey) {
  const parts = String(venueKey ?? "").split("|");
  const lat = Number(parts.at(-2));
  const lng = Number(parts.at(-1));
  return parts.length >= 4 && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function osmIdFromPlacesVenueId(venueId) {
  const match = /^venue-osm-([nwr])(\d+)$/.exec(String(venueId ?? ""));
  return match ? `${OSM_TYPE_BY_PREFIX[match[1]]}/${match[2]}` : null;
}

/**
 * Page key → the pubs that state that page as their own website.
 * `osmPubs` rows carry `osmId`, `name`, `lat`, `lng`, `website`; `placesVenues`
 * rows carry a `venue-osm-…` `venueId` and `websiteUri.value`.
 */
export function buildMenuPageOwners({ osmPubs, placesVenues = [] }) {
  const owners = new Map();
  const byOsmId = new Map();
  const add = (url, pub, source) => {
    const key = url ? menuPageKey(url) : null;
    if (!key || !Number.isFinite(pub.lat) || !Number.isFinite(pub.lng)) return;
    const list = owners.get(key) ?? [];
    if (!list.some((o) => o.osmId === pub.osmId)) {
      list.push({ osmId: pub.osmId, name: pub.name, lat: pub.lat, lng: pub.lng, source });
    }
    owners.set(key, list);
  };
  for (const pub of osmPubs) {
    byOsmId.set(pub.osmId, pub);
    add(pub.website, pub, "osm");
  }
  for (const venue of placesVenues) {
    const pub = byOsmId.get(osmIdFromPlacesVenueId(venue.venueId));
    if (pub) add(venue.websiteUri?.value, pub, "google-places");
  }
  return owners;
}

/** Reads both owner sources from the repo root. Missing OSM pubs is an error: no owner, no check. */
export function readMenuPageOwners(root) {
  const osmPath = join(root, OSM_PUBS_PATH);
  if (!existsSync(osmPath)) {
    throw new Error(`${OSM_PUBS_PATH} is missing, so no menu page owner can be checked`);
  }
  const osmPubs = JSON.parse(readFileSync(osmPath, "utf8")).pubs ?? [];
  const placesPath = join(root, PLACES_PATH);
  const placesVenues = existsSync(placesPath)
    ? (JSON.parse(readFileSync(placesPath, "utf8")).venues ?? [])
    : [];
  return buildMenuPageOwners({ osmPubs, placesVenues });
}

/**
 * `same-pub` when an owner of the page is within the limit of the point,
 * `other-pub` when every owner is further, `owner-unknown` when no pub states
 * the page (or the point is missing).
 */
export function menuOwnerVerdict(pageUrl, point, owners) {
  const key = pageUrl ? menuPageKey(pageUrl) : null;
  const list = key ? owners.get(key) : undefined;
  if (!list?.length || !point) return { verdict: "owner-unknown" };
  let nearest = null;
  for (const owner of list) {
    const metres = haversineMeters(point.lat, point.lng, owner.lat, owner.lng);
    if (!nearest || metres < nearest.metres) nearest = { owner, metres };
  }
  return {
    verdict: nearest.metres <= MENU_OWNER_MAX_METRES ? "same-pub" : "other-pub",
    owner: nearest.owner,
    metres: Math.round(nearest.metres),
  };
}
