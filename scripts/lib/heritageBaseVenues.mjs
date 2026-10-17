// The London pubs the NHLE listed-building join reads beyond the curated
// dataset: every OpenStreetMap pub in the London box that no curated venue
// owns, keyed by the `venue-uk-<osmRef>` id its base-layer sheet opens under
// (lib/ukBasePubs.ts). A pub a curated venue owns is matched once, under the
// curated id, so one building never carries two listings.
//
// OWNERSHIP IS THE MAP'S. The seed pack's `curatedRef` is only the first of the
// answers scripts/build_uk_base_shards.mjs gives, and the shard row's owner
// column is the whole answer: the base pin the map hides behind a curated pin.
// Reading that column here means the join and the map cannot disagree about
// which pin a building belongs to.
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
 * OSM ref ("n123") → owning curated venue id, from published uk_base shard
 * bodies (`{ pubs: [[osmRef, name, address, lat, lng, curatedVenueId], …] }`).
 * A row with no owner is left out.
 */
export function baseRowOwners(shardBodies) {
  const owners = new Map();
  for (const body of Array.isArray(shardBodies) ? shardBodies : []) {
    for (const row of Array.isArray(body?.pubs) ? body.pubs : []) {
      if (!Array.isArray(row) || typeof row[0] !== "string") continue;
      const owner = typeof row[5] === "string" ? row[5].trim() : "";
      if (owner) owners.set(row[0], owner);
    }
  }
  return owners;
}

/**
 * `{ id, name, lat, lng }` for every named London-box pub in the UK seed pack
 * (data/osm/uk/uk_osm_pubs.json) that carries no `curatedRef` and whose OSM
 * ref is not in `ownedBy` (the base layer's owners, see `baseRowOwners`).
 */
export function londonBaseVenues(seedPubs, { box = LONDON_BOX, ownedBy = new Map() } = {}) {
  const venues = [];
  const seen = new Set();
  for (const pub of Array.isArray(seedPubs) ? seedPubs : []) {
    if (pub?.amenity !== "pub" || pub.curatedRef) continue;
    const name = typeof pub.name === "string" ? pub.name.trim() : "";
    const { lat, lng } = pub;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < box.minLat || lat > box.maxLat || lng < box.minLng || lng > box.maxLng) continue;
    const id = baseVenueIdFor(pub.osmId);
    if (!id || seen.has(id) || ownedBy.has(id.slice("venue-uk-".length))) continue;
    seen.add(id);
    venues.push({ id, name, lat, lng });
  }
  return venues;
}
