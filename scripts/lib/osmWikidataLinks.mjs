// OSM `wikidata` links for London pubs: the exact identity that joins an
// OpenStreetMap pub to its Wikidata item.
//
// ONE SOURCE PER PACK. This module reads only OpenStreetMap data (ODbL 1.0)
// and writes only what OSM states: which pub object names which Wikidata item.
// Wikidata's own statements live in their own pack
// (scripts/lib/wikidataHistoryPack.mjs, CC0) and the two meet at runtime.
//
// NOTHING IS GUESSED. A tag that is not one item id, or an item two London pubs
// both name (a brand or a chain, not a building), is dropped and counted.
// Whether an item is a pub at all is Wikidata's to say, so the history pack
// keeps an item only when Wikidata types it as one.

/** Greater London, the box the other London joins read. */
export const LONDON_BBOX = Object.freeze({ minLat: 51.28, maxLat: 51.7, minLng: -0.55, maxLng: 0.34 });

export const OSM_WIKIDATA_LINKS_VERSION = 1;

/** OSM "node" 123 → "n123", the ref a `venue-uk-n123` id carries. */
export function compactRef(type, id) {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (type === "node") return `n${id}`;
  if (type === "way") return `w${id}`;
  if (type === "relation") return `r${id}`;
  return null;
}

/** One Wikidata item id ("Q123"), or null. */
export function parseQid(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^Q[1-9]\d{0,11}$/.test(trimmed) ? trimmed : null;
}

function curatedVenueByRef(seedPubs) {
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
  for (const [ref, venueId] of byRef) if ((claims.get(venueId) ?? 0) > 1) byRef.delete(ref);
  return byRef;
}

/**
 * Every London `amenity=pub` in the raw Overpass chunks that names one
 * Wikidata item no other London pub names, as `[osmRef, qid, curatedVenueId | null]`.
 */
export function buildOsmWikidataLinks({ chunks, seedPubs, fetchedAt, box = LONDON_BBOX }) {
  const seen = new Set();
  const tagged = [];
  const counts = { londonPubs: 0, tagged: 0, unreadableTag: 0, brandTag: 0, sharedItem: 0, linked: 0, curatedLinked: 0 };
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    for (const element of Array.isArray(chunk?.elements) ? chunk.elements : []) {
      const tags = element?.tags;
      if (tags?.amenity !== "pub") continue;
      const ref = compactRef(element.type, element.id);
      const lat = element.lat ?? element.center?.lat;
      const lng = element.lon ?? element.center?.lon;
      if (!ref || !Number.isFinite(lat) || !Number.isFinite(lng) || seen.has(ref)) continue;
      if (lat < box.minLat || lat > box.maxLat || lng < box.minLng || lng > box.maxLng) continue;
      seen.add(ref);
      counts.londonPubs += 1;
      if (tags.wikidata === undefined) continue;
      counts.tagged += 1;
      const qid = parseQid(tags.wikidata);
      if (!qid) {
        counts.unreadableTag += 1;
        continue;
      }
      // An item that is the pub's brand is the chain, not this building.
      if (parseQid(tags["brand:wikidata"]) === qid) {
        counts.brandTag += 1;
        continue;
      }
      tagged.push([ref, qid]);
    }
  }
  const namedBy = new Map();
  for (const [, qid] of tagged) namedBy.set(qid, (namedBy.get(qid) ?? 0) + 1);
  const curated = curatedVenueByRef(seedPubs);
  const links = [];
  for (const [ref, qid] of tagged) {
    if ((namedBy.get(qid) ?? 0) > 1) {
      counts.sharedItem += 1;
      continue;
    }
    const venueId = curated.get(ref) ?? null;
    if (venueId) counts.curatedLinked += 1;
    links.push([ref, qid, venueId]);
  }
  counts.linked = links.length;
  links.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    version: OSM_WIKIDATA_LINKS_VERSION,
    source: "OpenStreetMap",
    sourceUrl: "https://www.openstreetmap.org/",
    license: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "© OpenStreetMap contributors",
    fetchedAt,
    tag: "wikidata",
    area: `Greater London bounding box (lat ${box.minLat}-${box.maxLat}, lng ${box.minLng}-${box.maxLng})`,
    counts,
    links,
  };
}
