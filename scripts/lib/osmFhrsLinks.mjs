// OSM `fhrs:id` links for London pubs: the exact identity that joins an
// OpenStreetMap pub to its Food Standards Agency (FSA) establishment.
//
// ONE SOURCE PER PACK. This module reads only OpenStreetMap data (ODbL 1.0)
// and writes only what OSM states: which pub object carries which `fhrs:id`.
// The FSA's ratings live in their own pack (scripts/lib/fsaHygienePack.mjs,
// OGL v3.0) and the two meet at runtime (lib/fsaHygienePack.ts), so neither
// licence's data is ever copied into the other's file.
//
// NOTHING IS GUESSED. A tag naming two establishments ("70278;100386") does not
// say which one is the pub, so it is dropped and counted. A curated venue that
// two OSM objects both claim is left on its base ids only. A pub with no tag
// gets no row, and no row never means "no rating".

/** Greater London, the box scripts/build_heritage_listings.mjs reads. */
export const LONDON_BBOX = Object.freeze({ minLat: 51.28, maxLat: 51.7, minLng: -0.55, maxLng: 0.34 });

export const OSM_FHRS_LINKS_VERSION = 1;

/** OSM "node" 123 → the compact "n123" a `venue-uk-n123` id carries. */
export function compactRef(type, id) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (type === "node") return `n${id}`;
  if (type === "way") return `w${id}`;
  if (type === "relation") return `r${id}`;
  return null;
}

/** A single FSA establishment id, or null for anything else (two ids, text, zero). */
export function parseFhrsId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[1-9]\d{0,9}$/.test(trimmed)) return null;
  return Number(trimmed);
}

function elementPoint(element) {
  const lat = element?.lat ?? element?.center?.lat;
  const lng = element?.lon ?? element?.center?.lon;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function inBox(point, box) {
  return point.lat >= box.minLat && point.lat <= box.maxLat && point.lng >= box.minLng && point.lng <= box.maxLng;
}

/**
 * The curated London venue each OSM pub is, as the UK seed pack records it
 * (`curatedRef`, data/osm/uk/uk_osm_pubs.json). A venue two OSM objects claim
 * is not anybody's: its curated link is dropped and counted.
 */
export function curatedVenueByRef(seedPubs) {
  const byRef = new Map();
  const claims = new Map();
  for (const pub of Array.isArray(seedPubs) ? seedPubs : []) {
    if (pub?.curatedRef?.source !== "curated-london-slim") continue;
    const venueId = pub.curatedRef.id;
    const [type, rawId] = String(pub.osmId ?? "").split("/");
    const ref = compactRef(type, Number(rawId));
    if (!ref || typeof venueId !== "string" || !venueId) continue;
    byRef.set(ref, venueId);
    claims.set(venueId, (claims.get(venueId) ?? 0) + 1);
  }
  let ambiguous = 0;
  for (const [ref, venueId] of byRef) {
    if ((claims.get(venueId) ?? 0) > 1) {
      byRef.delete(ref);
      ambiguous += 1;
    }
  }
  return { byRef, ambiguous };
}

/**
 * Every London `amenity=pub` the raw Overpass chunks hold that carries one
 * `fhrs:id`, as `[osmRef, fhrsId, curatedVenueId | null]`, sorted by ref.
 */
export function buildOsmFhrsLinks({ chunks, seedPubs, fetchedAt, box = LONDON_BBOX }) {
  const seen = new Set();
  const links = [];
  const counts = { londonPubs: 0, linked: 0, multiValueTag: 0, unreadableTag: 0, curatedLinked: 0, curatedAmbiguous: 0 };
  const curated = curatedVenueByRef(seedPubs);
  counts.curatedAmbiguous = curated.ambiguous;
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    for (const element of Array.isArray(chunk?.elements) ? chunk.elements : []) {
      if (element?.tags?.amenity !== "pub") continue;
      const ref = compactRef(element.type, element.id);
      const point = elementPoint(element);
      if (!ref || !point || !inBox(point, box) || seen.has(ref)) continue;
      seen.add(ref);
      counts.londonPubs += 1;
      const tag = element.tags["fhrs:id"];
      if (tag === undefined) continue;
      const fhrsId = parseFhrsId(tag);
      if (fhrsId === null) {
        if (String(tag).includes(";")) counts.multiValueTag += 1;
        else counts.unreadableTag += 1;
        continue;
      }
      const venueId = curated.byRef.get(ref) ?? null;
      if (venueId) counts.curatedLinked += 1;
      links.push([ref, fhrsId, venueId]);
      counts.linked += 1;
    }
  }
  links.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    version: OSM_FHRS_LINKS_VERSION,
    source: "OpenStreetMap",
    sourceUrl: "https://www.openstreetmap.org/",
    license: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "© OpenStreetMap contributors",
    fetchedAt,
    tag: "fhrs:id",
    area: `Greater London bounding box (lat ${box.minLat}-${box.maxLat}, lng ${box.minLng}-${box.maxLng})`,
    counts,
    links,
  };
}
