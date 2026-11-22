"use client";

import { useMemo } from "react";
import {
  londonRestaurantsPassingMapFilters,
  londonRestaurantsWithoutCuratedTwin,
  type LondonRestaurant,
} from "@/lib/londonRestaurants";
import type { Venue } from "@/lib/venues";
import type { LondonRestaurantsState } from "./useLondonRestaurants";

const NO_RESTAURANTS: readonly LondonRestaurant[] = [];

type Input = Omit<Parameters<typeof londonRestaurantsPassingMapFilters>[1], "curated" | "restaurantKindVisible"> & {
  restaurants: readonly LondonRestaurant[];
  mode: LondonRestaurantsState["mode"];
  baseVenues: readonly Venue[];
  canvasVenues: readonly Venue[];
};

export function useFilteredLondonRestaurants({
  restaurants, mode, baseVenues, canvasVenues, filters, savedOnly, nearMe, selectedVenueId,
}: Input): readonly LondonRestaurant[] {
  const canvasIds = useMemo(() => JSON.stringify(canvasVenues.map(venue => venue.id)), [canvasVenues]);
  const twinVenues = useMemo(() => {
    const ids = new Set<string>(JSON.parse(canvasIds));
    // Price refreshes change the pin objects, but not their names or positions.
    return baseVenues.filter(venue => ids.has(venue.id));
  }, [baseVenues, canvasIds]);
  return useMemo(
    () => mode !== "off"
      ? londonRestaurantsWithoutCuratedTwin(
          londonRestaurantsPassingMapFilters(restaurants, {
            filters, savedOnly, nearMe, selectedVenueId,
            restaurantKindVisible: mode === "layer",
            curated: baseVenues,
          }),
          twinVenues, selectedVenueId,
        )
      : NO_RESTAURANTS,
    [restaurants, mode, baseVenues, twinVenues, filters, savedOnly, nearMe, selectedVenueId],
  );
}
