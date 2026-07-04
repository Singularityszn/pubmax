import type { Venue } from "@/lib/venues";

// Straight-line (haversine) distance in km from a point to a venue. Mirrors the
// landmarks haversine deliberately — nearby has no dependency on the heritage layer.
function haversineKm(lat: number, lng: number, venue: Venue): number {
  const earthRadiusKm = 6371;
  const dLat = ((venue.latitude - lat) * Math.PI) / 180;
  const dLng = ((venue.longitude - lng) * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lat2 = (venue.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// The n venue ids closest to (lat, lng), nearest first. Deterministic, pure,
// safe on empty input; n is clamped to [0, venues.length].
export function nearestVenueIds(
  lat: number,
  lng: number,
  venues: Venue[],
  n: number,
): string[] {
  const take = Math.max(0, Math.min(Math.floor(n), venues.length));
  if (take === 0) return [];
  return venues
    .map((venue) => ({ id: venue.id, km: haversineKm(lat, lng, venue) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, take)
    .map((entry) => entry.id);
}
