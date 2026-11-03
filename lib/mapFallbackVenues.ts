import { comparableVenuePint, type ComparablePintVenue } from "@/lib/comparableVenuePint";
import type { VenueKind } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export type MapFallbackVenue = ComparablePintVenue & {
  id: string;
  kind?: VenueKind;
  cheapestPrice: number | null;
};

export function selectMapFallbackPubs<T extends MapFallbackVenue>(
  venues: readonly T[],
  limit: number,
): T[] {
  return venues
    .filter((venue) => isPubVenueKind(venue.kind))
    .sort((a, b) => (comparableVenuePint(a, null, false) ?? Infinity) - (comparableVenuePint(b, null, false) ?? Infinity))
    .slice(0, limit);
}
