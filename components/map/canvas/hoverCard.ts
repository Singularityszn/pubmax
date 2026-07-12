import { formatFreshness, formatObservedAt, type Venue } from "@/lib/venues";
import { proxiedVenueImageUrl } from "@/lib/venueImages";
import type { PricedVenue } from "@/lib/priceUpdates";
import type { VenueSignal, FailedHoverImage } from "./types";

export const HOVER_DETAIL_CACHE_LIMIT = 24;
export const HOVER_CARD_VIEWPORT_GUTTER_PX = 16;
export const HOVER_CARD_WIDTH_PX = 292;
export const HOVER_CARD_HEIGHT_PX = 138;
export const HOVER_CARD_MIN_TOP_PX = 84;
export const HOVER_CARD_X_OFFSET_PX = 18;
export const HOVER_CARD_Y_OFFSET_PX = -30;

export function withBoundedHoverDetailCache(
  details: Map<string, Venue | null>,
  id: string,
  venue: Venue | null,
): Map<string, Venue | null> {
  const next = new Map(details);
  next.delete(id);
  next.set(id, venue);
  while (next.size > HOVER_DETAIL_CACHE_LIMIT) {
    const oldestId = next.keys().next().value;
    if (oldestId === undefined) break;
    next.delete(oldestId);
  }
  return next;
}

export function hoverImageUrlFor(
  hoverDetail: Venue | null | undefined,
  failedImage: FailedHoverImage | null,
  hoveredVenueId: string | null,
): string {
  const src = proxiedVenueImageUrl(hoverDetail?.imageUrl ?? "");
  if (failedImage?.venueId === hoveredVenueId && failedImage.url === src) return "";
  return src;
}

export type HoverPriceLine = {
  price: number | null;
  provenance: string;
};

// Compact honesty line for the map hover card. Price and provenance share one
// precedence stack (community → sourced → baseline) so a baseline API detail
// fetch never pairs with a Community/Sourced label.
export function hoverPriceLine(
  mapVenue: Venue | undefined,
  signal: VenueSignal | undefined,
  hoverDetail: Venue | null | undefined,
): HoverPriceLine {
  const communityPrice =
    signal?.latestContributorPrice ?? mapVenue?.latestContributorPrice ?? null;
  if (communityPrice !== null && communityPrice !== undefined) {
    const fresh = formatFreshness(mapVenue?.latestContributorAt);
    return {
      price: communityPrice,
      provenance: fresh ? `Community · ${fresh}` : "Community · tap for detail",
    };
  }
  const sourced = (mapVenue as PricedVenue | undefined)?.sourcedPrice ?? null;
  if (sourced) {
    const observed = formatObservedAt(sourced.observedAt);
    // mergePriceUpdates already wrote the sourced amount onto cheapestPrice.
    const price =
      mapVenue?.cheapestPrice ?? hoverDetail?.cheapestPrice ?? null;
    return {
      price: price ?? null,
      provenance: observed ? `Sourced · ${observed}` : "Sourced · tap for detail",
    };
  }
  const baseline =
    mapVenue?.cheapestPrice ?? hoverDetail?.cheapestPrice ?? null;
  if (baseline !== null && baseline !== undefined) {
    return { price: baseline, provenance: "Baseline · tap for detail" };
  }
  return { price: null, provenance: "Tap for detail" };
}
