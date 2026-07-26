/**
 * Canonical normalizer for raw OpenStreetMap pub/bar elements.
 *
 * City, London borough, and UK-wide seed builders consume this module so field
 * retention cannot drift between data packs.
 */

/**
 * @param {Record<string, string> | undefined} tags
 * @param {string | null} fallbackCity
 */
function buildAddress(tags, fallbackCity) {
  if (!tags) return fallbackCity;
  const parts = [];
  if (tags["addr:housenumber"]) parts.push(tags["addr:housenumber"]);
  if (tags["addr:street"]) parts.push(tags["addr:street"]);
  const city = tags["addr:city"] || fallbackCity;
  if (city) parts.push(city);
  if (tags["addr:postcode"]) parts.push(tags["addr:postcode"]);
  return parts.join(", ") || fallbackCity;
}

/**
 * Keep every `smoking` and `smoking:*` tag verbatim. OSM uses values such as
 * `outside`, `isolated`, and `separated`, so reducing these to a boolean would
 * discard information needed by a future filter.
 *
 * @param {Record<string, string>} tags
 */
function collectSmokingTags(tags) {
  const smoking = {};
  for (const [key, value] of Object.entries(tags)) {
    if (key === "smoking" || key.startsWith("smoking:")) smoking[key] = value;
  }
  return Object.keys(smoking).length > 0 ? smoking : null;
}

/**
 * @param {any} element raw Overpass node/way with tags and coordinates
 * @param {{ fallbackCity?: string | null }} [options]
 * @returns {Record<string, unknown> | null}
 */
export function normalizeOsmPubElement(element, { fallbackCity = null } = {}) {
  const tags = element?.tags ?? {};
  const name = typeof tags.name === "string" ? tags.name.trim() : "";
  if (!name) return null;

  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    osmId: `${element.type}/${element.id}`,
    name,
    amenity: typeof tags.amenity === "string" ? tags.amenity : null,
    lat,
    lng,
    address: buildAddress(tags, fallbackCity),
    postcode: tags["addr:postcode"] || null,
    website: tags.website || tags["contact:website"] || null,
    phone: tags.phone || tags["contact:phone"] || null,
    openingHours: tags.opening_hours || null,
    brewery: tags.brewery || null,
    operator: tags.operator || null,
    outdoorSeating: tags.outdoor_seating === "yes",
    smoking: collectSmokingTags(tags),
    cuisine: tags.cuisine || null,
    wikidata: tags.wikidata || null,
    wikipedia: tags.wikipedia || null,
  };
}

/**
 * Sort normalized OSM pubs by stable geographic and identity keys.
 *
 * @param {Array<Record<string, any>>} pubs
 */
export function sortOsmPubs(pubs) {
  pubs.sort(
    (a, b) =>
      a.lat - b.lat ||
      a.lng - b.lng ||
      String(a.name).localeCompare(String(b.name)) ||
      String(a.osmId).localeCompare(String(b.osmId)),
  );
  return pubs;
}
