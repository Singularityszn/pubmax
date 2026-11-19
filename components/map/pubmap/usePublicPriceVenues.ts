"use client";

import type { CityId } from "@/lib/cities";
import type { CommunityPrice } from "@/lib/communityPrice";
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
  communityPrices: ReadonlyMap<string, readonly CommunityPrice[]>,
): Venue[] {
  const venues = useMemo(() => mergePriceUpdates(mergeVenueDrops(baseVenues, drops), cityId === "london" ? priceUpdates : [], venueUpdateKey), [baseVenues, drops, priceUpdates, cityId]);
  const { ids, evidenceByVenue } = useMemo(() => {
    const ids: string[] = [];
    const evidenceByVenue = new Map<string, string>();
    for (const venue of venues) {
      const recorded = venue.cheapestPrice !== null || venue.hasRecordedPrice === true;
      const communityRows = communityPrices.get(venue.id);
      const evidence = communityRows?.length
        ? JSON.stringify([recorded, communityRows])
        : recorded ? "recorded" : "no-local-price";
      evidenceByVenue.set(venue.id, evidence);
      const bundle = venue as Venue & { bundlePrices?: { estimate?: unknown } };
      if (!recorded && (venue.zone != null || bundle.bundlePrices?.estimate)) ids.push(venue.id);
    }
    return { ids, evidenceByVenue };
  }, [venues, communityPrices]);
  const presence = usePublicPricePresence(ids, evidenceByVenue, evidenceByVenue);
  return useMemo(() => venues.map((venue) => ({ ...venue, publicPricePresence: communityPrices.get(venue.id)?.length
    ? "present" as const : presence.get(venue.id) ?? "unknown" })), [venues, presence, communityPrices]);
}
