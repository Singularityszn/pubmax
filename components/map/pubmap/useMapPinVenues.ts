"use client";
import { fairPintActive, subscribeFairPintActive } from "@/lib/fairPint";
import { NO_PINT_PRICE_CAP } from "@/lib/pintPriceCapValue";

import { useMemo, useSyncExternalStore } from "react";
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
  dealIds,
}: {
  venues: readonly Venue[];
  mapFilters: Filters;
  venueSignals: ReadonlyMap<string, { hasPintDrops: boolean; latestContributorPrice: number | null; latestContributorAt?: number | null }>;
  openNowStateById: ReadonlyMap<string, OpenNowState> | null;
  savedOnly: boolean;
  savedIds: ReadonlySet<string>;
  /** Last orders' open set; null only while off. Empty while its hours are read. */
  lastOrdersIds: ReadonlySet<string> | null;
  dealIds?: ReadonlySet<string> | null;
}): Venue[] {
  const fairActive = useSyncExternalStore(subscribeFairPintActive, fairPintActive, () => false);
  const filterInput = fairActive ? { ...mapFilters, maxPrice: NO_PINT_PRICE_CAP } : mapFilters;
  const pinFilterKey = JSON.stringify(mapPinFilters(filterInput));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key includes every non-query filter
  const pinFilters = useMemo(() => mapPinFilters(filterInput), [pinFilterKey]);
  return useMemo(() => {
    const candidates = filterMapVenues(
      venues,
      pinFilters,
      (id) => Boolean(venueSignals.get(id)?.hasPintDrops),
      (id) => openNowStateById?.get(id) ?? "unknown",
      venueSignals,
    );
    const saved = savedOnly ? candidates.filter((venue) => savedIds.has(venue.id)) : candidates;
    return saved.filter((venue) => (!lastOrdersIds || lastOrdersIds.has(venue.id)) && (!dealIds || dealIds.has(venue.id)));
  }, [dealIds, lastOrdersIds, openNowStateById, pinFilters, savedIds, savedOnly, venues, venueSignals]);
}

