"use client";

import { useEffect } from "react";

import type { CityId } from "@/lib/cities";
import { isNationalBaseVenueId, venueIdMatchesCity } from "@/lib/cityVenueIds";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import { warmVenueDetail } from "@/lib/warmVenueDetail";

/** A shared crawl must resolve its stops outside the map's loaded cells. */
export function useBuiltVenueDetails({
  cityId,
  builtIds,
  venueById,
  onResolved,
}: {
  cityId: CityId;
  builtIds: readonly string[];
  venueById: ReadonlyMap<string, Venue>;
  onResolved: (venues: ReadonlyMap<string, Venue>) => void;
}): void {
  useEffect(() => {
    const missing = [...new Set(builtIds)].filter((id) =>
      !venueById.has(id) && !isNationalBaseVenueId(id) && venueIdMatchesCity(id, cityId),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (id) => [id, await warmVenueDetail(id)] as const))
      .then((results) => {
        if (cancelled) return;
        const found = new Map<string, Venue>();
        for (const [id, result] of results) {
          if (result.status === "found" && isPubVenue(result.venue) && venueIdMatchesCity(result.venue.id, cityId)) {
            found.set(id, result.venue);
          }
        }
        if (found.size > 0) onResolved(found);
      });
    return () => { cancelled = true; };
  }, [builtIds, cityId, onResolved, venueById]);
}
