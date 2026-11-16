"use client";

import type { CityId } from "@/lib/cities";
import { useMemo } from "react";
import { usePublicPricePresence } from "@/components/usePublicPricePresence";
import { mergeVenueDrops, type Venue } from "@/lib/venues";
import { mergePriceUpdates, type PriceUpdate } from "@/lib/priceUpdates";
import { venueUpdateKey } from "@/lib/pubMap";

export function usePublicPriceVenues(
  baseVenues: Venue[],
  drops: Parameters<typeof mergeVenueDrops>[1],
  priceUpdates: PriceUpdate[],
  cityId: CityId,
): Venue[] {
  const venues = useMemo(() => mergePriceUpdates(mergeVenueDrops(baseVenues, drops), cityId === "london" ? priceUpdates : [], venueUpdateKey), [baseVenues, drops, priceUpdates, cityId]);
  const ids = useMemo(() => venues.filter((venue) => venue.cheapestPrice === null && venue.hasRecordedPrice !== true
    && (venue.zone != null || (venue as Venue & { bundlePrices?: { estimate?: unknown } }).bundlePrices?.estimate)).map((venue) => venue.id), [venues]);
  const presence = usePublicPricePresence(ids, venues);
  return useMemo(() => venues.map((venue) => ({ ...venue, publicPricePresence: presence.get(venue.id) ?? "unknown" })), [venues, presence]);
}
