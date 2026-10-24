import type { VenueFeatureObservation } from "../../lib/venues";
export function buildVenueFeatureHints(
  venues: readonly { id: string; name: string; lat: number; lng: number }[],
  pubs: readonly unknown[], facts: readonly unknown[], places: readonly unknown[],
): Map<string, { outdoorSeating?: VenueFeatureObservation; beerGarden?: VenueFeatureObservation }>;
