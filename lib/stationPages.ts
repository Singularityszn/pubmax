import stationData from "@/data/tfl_station_zones.json";
import walkData from "@/data/station_walk_access.json";
import { comparableVenuePint } from "@/lib/comparableVenuePint";
import { haversineMeters } from "@/lib/greatCircle.mjs";
import { streetWalkMetres } from "@/lib/stationWalkAccess";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

export type Station = { name: string; lat: number; lng: number; zone: number };

export function stationSlug(name: string): string {
  return name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const stations: Station[] = stationData.stations;
const walkStationNames = new Set(walkData.stations.map((station) => station.name));

export function stationFromSlug(slug: string): Station | null {
  return stations.find((station) => stationSlug(station.name) === slug) ?? null;
}

export function nearbyStationPubs(station: Station, venues: readonly Venue[]) {
  return venues.flatMap((venue) => {
    if (!isPubVenueKind(venue.kind) && !(venue.kind === "bar" && venue.legacyOsmBar)) return [];
    if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) return [];
    const straight = haversineMeters(station.lat, station.lng, venue.latitude, venue.longitude);
    if (straight > 1000) return [];
    const street = walkStationNames.has(station.name)
      ? streetWalkMetres({ lat: venue.latitude, lng: venue.longitude }, station)
      : null;
    return [{ venue, price: comparableVenuePint(venue), distanceMetres: street ?? straight, street: street !== null }];
  }).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.venue.name.localeCompare(b.venue.name) || a.venue.id.localeCompare(b.venue.id));
}
