"use client";

import type { CityId } from "@/lib/cities";
import type { CommunityPrice } from "@/lib/communityPrice";
import { DEFAULT_VISIBILITY, type PintDrop } from "@/lib/pintDropShared";
import { useMemo } from "react";
import { mergeVenueDrops, type SummaryDrop, type Venue } from "@/lib/venues";
import { mergePriceUpdates, type PriceUpdate } from "@/lib/priceUpdates";
import { venueUpdateKey } from "@/lib/pubMap";

type MapDrop = SummaryDrop & Pick<PintDrop, "id" | "status" | "visibility">;

/**
 * The map's venues with their merged prices. A pub whose public price the map
 * already holds is stamped `present`, which withholds its estimate. The map
 * asks the server nothing: published prices and these two feeds decide.
 */
export function usePublicPriceVenues(
  baseVenues: Venue[],
  drops: Map<string, MapDrop[]>,
  priceUpdates: PriceUpdate[],
  cityId: CityId,
  communityPrices: ReadonlyMap<string, readonly CommunityPrice[]>,
): Venue[] {
  const venues = useMemo(() => mergePriceUpdates(mergeVenueDrops(baseVenues, drops), cityId === "london" ? priceUpdates : [], venueUpdateKey), [baseVenues, drops, priceUpdates, cityId]);
  return useMemo(() => venues.map((venue) => communityPrices.get(venue.id)?.length || drops.get(venue.id)?.some(isPublicPricedDrop)
    ? { ...venue, publicPricePresence: "present" as const } : venue), [venues, drops, communityPrices]);
}

// The lanes the server counts in `isPubliclyReadableDrop` (lib/pintDrops.ts, server-only).
function isPublicPricedDrop(drop: MapDrop): boolean {
  const visibility = drop.visibility ?? DEFAULT_VISIBILITY;
  return !drop.optimistic && drop.provenance !== "demo" && drop.priceGbp !== null && drop.status === "visible"
    && (visibility === "public" || visibility === "anonymous");
}
