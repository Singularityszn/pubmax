// Nearest-station fare zone. Pure, so the slim build and the landing hero
// share one rule.
//
// TfL fare zones belong to stations, not to areas, so a venue takes the zone of
// its NEAREST station by great-circle distance. This is an approximation, and
// the UI says so. The table is data/tfl_station_zones.json.

import { haversineMeters } from "./greatCircle.mjs";

/**
 * The nearest station's zone, name and distance, or null when no station can
 * be compared (an empty table or a point that is not a number).
 */
export function nearestStationZone(lat, lng, stations) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Array.isArray(stations)) {
    return null;
  }
  let best = null;
  for (const station of stations) {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) continue;
    const distanceKm = haversineMeters(lat, lng, station.lat, station.lng) / 1_000;
    if (!best || distanceKm < best.distanceKm) {
      best = { zone: station.zone, station: station.name, distanceKm };
    }
  }
  return best;
}
