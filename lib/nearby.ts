import { haversineKm } from "@/lib/haversine";
import type { Venue } from "@/lib/venues";

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
    .map((venue) => ({
      id: venue.id,
      km: haversineKm([lng, lat], [venue.longitude, venue.latitude]),
    }))
    .sort((a, b) => a.km - b.km)
    .slice(0, take)
    .map((entry) => entry.id);
}
