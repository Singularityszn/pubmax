import { useMemo } from "react";

import { withForcedVenue } from "@/lib/filterMapVenues";
import { venuesInNearbyMembership, type NearbyMapMembership } from "@/lib/mapNearbyMembership";
import { filterVenuesForExperienceLens, type MapExperienceLens, type MapLensPrice } from "@/lib/mapExperienceLens";
import { filterVenuesByKind, isPubVenue, type VenueKindVisibility } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

export function useMapVenueCollections({
  filteredVenues,
  pinVenues,
  nearbyMapResultForView,
  experienceLens,
  noAlcoholLensPrices,
  venueKindVisibility,
  venueById,
  selectedVenueId,
  query,
  searchPickedVenueId,
}: {
  filteredVenues: Venue[];
  pinVenues: Venue[];
  nearbyMapResultForView: NearbyMapMembership;
  experienceLens: MapExperienceLens;
  noAlcoholLensPrices: ReadonlyMap<string, MapLensPrice>;
  venueKindVisibility: VenueKindVisibility;
  venueById: ReadonlyMap<string, Venue>;
  selectedVenueId: string;
  query: string;
  searchPickedVenueId: string;
}) {
  const mapMembershipVenues = useMemo(
    () => venuesInNearbyMembership(pinVenues, nearbyMapResultForView),
    [pinVenues, nearbyMapResultForView],
  );
  const experienceVisibleMapVenues = useMemo(
    () => filterVenuesForExperienceLens(mapMembershipVenues, experienceLens, noAlcoholLensPrices),
    [experienceLens, mapMembershipVenues, noAlcoholLensPrices],
  );
  const kindVisibleMapVenues = useMemo(
    () => filterVenuesByKind(experienceVisibleMapVenues, venueKindVisibility),
    [experienceVisibleMapVenues, venueKindVisibility],
  );
  const searchMatchVenues = useMemo(() => {
    const drawableIds = new Set(kindVisibleMapVenues.map((venue) => venue.id));
    return filteredVenues.filter((venue) => drawableIds.has(venue.id));
  }, [filteredVenues, kindVisibleMapVenues]);
  const filteredPubVenues = useMemo(
    () => searchMatchVenues.filter(isPubVenue),
    [searchMatchVenues],
  );
  const canvasVenues = useMemo(
    () => withForcedVenue(kindVisibleMapVenues, venueById, selectedVenueId || (query.trim() ? searchPickedVenueId : "")),
    [kindVisibleMapVenues, venueById, selectedVenueId, query, searchPickedVenueId],
  );
  return { filteredPubVenues, searchMatchVenues, kindVisibleMapVenues, canvasVenues };
}
