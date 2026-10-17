// The London pubs the NHLE listed-building join reads beyond the curated
// dataset: every OpenStreetMap pub in the London box that no curated venue
// owns, keyed by the `venue-uk-<osmRef>` id its base-layer sheet opens under
// (lib/ukBasePubs.ts). A pub a curated venue owns is matched once, under the
// curated id, so one building never carries two listings.
//
// Only the id, the name and the point are taken, and only to run the match:
// the pack the join writes holds Historic England's facts alone.

/** Greater London, the same box the NHLE read uses. */
export const LONDON_BOX = Object.freeze({ minLat: 51.28, maxLat: 51.7, minLng: -0.55, maxLng: 0.34 });

/** OSM "node/123" → "venue-uk-n123", the id a base pub's sheet opens under. */
export function baseVenueIdFor(osmId) {
  const [type, id] = String(osmId ?? "").split("/");
  if (!/^[1-9]\d*$/.test(id ?? "")) return null;
  const prefix = type === "node" ? "n" : type === "way" ? "w" : type === "relation" ? "r" : null;
  return prefix ? `venue-uk-${prefix}${id}` : null;
}

/**
 * `{ id, name, lat, lng }` for every named London-box pub in the UK seed pack
 * (data/osm/uk/uk_osm_pubs.json) that carries no `curatedRef`.
 */
export function londonBaseVenues(seedPubs, box = LONDON_BOX) {
  const venues = [];
  const seen = new Set();
  for (const pub of Array.isArray(seedPubs) ? seedPubs : []) {
    if (pub?.amenity !== "pub" || pub.curatedRef) continue;
    const name = typeof pub.name === "string" ? pub.name.trim() : "";
    const { lat, lng } = pub;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < box.minLat || lat > box.maxLat || lng < box.minLng || lng > box.maxLng) continue;
    const id = baseVenueIdFor(pub.osmId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    venues.push({ id, name, lat, lng });
  }
  return venues;
}
