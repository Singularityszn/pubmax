import { haversineMeters } from "../../lib/greatCircle.mjs";

export { haversineMeters };

/** Great-circle distance in kilometres between two latitude/longitude points. */
export function haversineKm(aLat, aLng, bLat, bLng) {
  return haversineMeters(aLat, aLng, bLat, bLng) / 1_000;
}

/** Great-circle distance in kilometres for longitude-first scalar coordinates. */
export function haversineKmLngLat(aLng, aLat, bLng, bLat) {
  return haversineKm(aLat, aLng, bLat, bLng);
}
