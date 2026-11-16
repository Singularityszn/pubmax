"use client";

import { useMemo } from "react";
import { filterMapVenues } from "@/lib/filterMapVenues";
import { mapPinFilters } from "@/lib/pubMap";
import type { OpenNowState } from "@/lib/openNow";
import type { Filters, Venue } from "@/lib/venues";

/**
 * Search narrows the results and camera, not the surrounding price context.
 * Pins keep every other filter after a query is restored or its field blurs.
 */
export function useMapPinVenues({
  venues,
  mapFilters,
  venueSignals,
  openNowStateById,
  savedOnly,
  savedIds,
  lastOrdersIds,
}: {
  venues: readonly Venue[];
  mapFilters: Filters;
  venueSignals: ReadonlyMap<string, { hasPintDrops: boolean; latestContributorPrice: number | null; latestContributorAt?: number | null }>;
  openNowStateById: ReadonlyMap<string, OpenNowState> | null;
  savedOnly: boolean;
  savedIds: ReadonlySet<string>;
  /** Last orders' open set; null only while off. Empty while its hours are read. */
  lastOrdersIds: ReadonlySet<string> | null;
}): Venue[] {
  const pinFilterKey = JSON.stringify(mapPinFilters(mapFilters));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key includes every non-query filter
  const pinFilters = useMemo(() => mapPinFilters(mapFilters), [pinFilterKey]);
  return useMemo(() => {
    const candidates = filterMapVenues(
      venues,
      pinFilters,
      (id) => Boolean(venueSignals.get(id)?.hasPintDrops),
      (id) => openNowStateById?.get(id) ?? "unknown",
      venueSignals,
    );
    const saved = savedOnly ? candidates.filter((venue) => savedIds.has(venue.id)) : candidates;
    return lastOrdersIds ? saved.filter((venue) => lastOrdersIds.has(venue.id)) : saved;
  }, [lastOrdersIds, openNowStateById, pinFilters, savedIds, savedOnly, venues, venueSignals]);
}

