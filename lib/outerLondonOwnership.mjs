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

export function outerLondonOwnerForPub(pub, curatedVenues) {
  const exactId = stableVenueIdFromKey(
    venueGroupingKey({
      pub_name: String(pub?.name ?? ""),
      address: String(pub?.address ?? ""),
      latitude: Number(pub?.lat),
      longitude: Number(pub?.lng),
    }),
  );
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
