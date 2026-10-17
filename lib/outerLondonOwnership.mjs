import {
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
  stableVenueIdFromKey,
  venueGroupingKey,
} from "../scripts/lib/venueCanonicalization.mjs";

const CURATED_MATCH_RADIUS_M = 150;
// A great-circle distance is never shorter than its latitude arc, so a venue
// further than this many degrees north or south cannot be inside the radius.
// The small margin keeps float rounding from dropping an edge match; the
// haversine below still decides.
const CURATED_MATCH_LAT_DEGREES = 0.0014;

export function outerLondonOwnerForPub(pub, curatedVenues, venueAliases = {}) {
  const ownId = stableVenueIdFromKey(
    venueGroupingKey({
      pub_name: String(pub?.name ?? ""),
      address: String(pub?.address ?? ""),
      latitude: Number(pub?.lat),
      longitude: Number(pub?.lng),
    }),
  );
  // A pub whose own record canonicalize:venues merged away is owned by the
  // venue that kept it.
  const exactId = venueAliases[ownId] ?? ownId;
  if (curatedVenues.some((venue) => venue.id === exactId)) return exactId;

  const normalizedName = normalizeVenueIdentityName(pub?.name);
  let bestId = null;
  let bestDistance = Infinity;
  for (const venue of curatedVenues) {
    if (Math.abs(venue.lat - pub.lat) > CURATED_MATCH_LAT_DEGREES) continue;
    const distance = haversineMeters(pub.lat, pub.lng, venue.lat, venue.lng);
    if (distance > CURATED_MATCH_RADIUS_M || distance >= bestDistance) continue;
    if (!namesLikelySamePub(normalizedName, normalizeVenueIdentityName(venue.name))) {
      continue;
    }
    bestId = venue.id;
    bestDistance = distance;
  }
  return bestId;
}

// THE NEAR-NAME FALLBACK. A base pub the seed's `curatedRef` and the OSM-id
// owners both miss is still the curated pub when the two spell one name two
// ways ("The King & Queen" and "The King and Queen", "Royal Oak" and "The
// Royal Oak Public House"). A near name is weaker evidence than an exact one,
// so it is gated at the 45 m the fuzzy merge in canonicalize:venues uses, not
// the 150 m an exact name earns.
export const NEAR_NAME_OWNER_RADIUS_M = 45;
const METRES_PER_LAT_DEGREE = 111_000;

// "Public House" and a possessive "'s" are the two spellings
// normalizeVenueIdentityName keeps apart and namesLikelySamePub then refuses:
// "The Champion" against "The Champion Public House", "Paxtons Head" against
// "Paxton’s Head".
function nearNameKey(name) {
  return normalizeVenueIdentityName(
    String(name ?? "")
      .replace(/[’‘`']s\b/gi, "s")
      .replace(/\bpublic\s+house\b/gi, " "),
  );
}

/**
 * `(pub) => curated venue id | null`: the nearest curated venue within
 * `radiusM` whose name `namesLikelySamePub` reads as the pub's.
 */
export function nearNameOwnerIndex(curatedVenues, { radiusM = NEAR_NAME_OWNER_RADIUS_M } = {}) {
  const cellDegrees = radiusM / METRES_PER_LAT_DEGREE;
  const cells = new Map();
  for (const venue of curatedVenues) {
    if (!Number.isFinite(venue?.lat) || !Number.isFinite(venue?.lng)) continue;
    const key = Math.floor(venue.lat / cellDegrees);
    const entry = { id: venue.id, lat: venue.lat, lng: venue.lng, name: nearNameKey(venue.name) };
    const bucket = cells.get(key);
    if (bucket) bucket.push(entry);
    else cells.set(key, [entry]);
  }
  return (pub) => {
    if (!Number.isFinite(pub?.lat) || !Number.isFinite(pub?.lng)) return null;
    const name = nearNameKey(pub.name);
    if (!name) return null;
    const row = Math.floor(pub.lat / cellDegrees);
    let bestId = null;
    let bestDistance = Infinity;
    for (let dRow = -1; dRow <= 1; dRow += 1) {
      for (const venue of cells.get(row + dRow) ?? []) {
        const distance = haversineMeters(pub.lat, pub.lng, venue.lat, venue.lng);
        if (distance > radiusM || distance >= bestDistance) continue;
        if (!namesLikelySamePub(name, venue.name)) continue;
        bestId = venue.id;
        bestDistance = distance;
      }
    }
    return bestId;
  };
}
