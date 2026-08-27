import { formatPintDatasetAsOf } from "@/lib/dataFreshness";
import { formatFreshness, formatObservedAt } from "@/lib/venues";
import type { VenueKind } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";

type VenuePriceFreshnessInput = Readonly<{
  cheapestPrice: number | null;
  latestContributorPrice: number | null;
  latestContributorAt: string | null;
  sourcedPrice?: Readonly<{ observedAt: string }> | null;
  kind?: VenueKind;
  anchorObservedAt?: string;
}>;

/** Label the timestamp that owns the visible price figure. */
export function venuePriceFreshnessLabel(
  venue: VenuePriceFreshnessInput,
  now: Date = new Date(),
): string {
  if (venue.sourcedPrice) {
    return formatObservedAt(venue.sourcedPrice.observedAt, now);
  }
  if (!isPubVenueKind(venue.kind) && venue.anchorObservedAt) {
    return formatObservedAt(venue.anchorObservedAt, now);
  }
  if (
    venue.latestContributorAt
    && venue.latestContributorPrice === venue.cheapestPrice
  ) {
    return formatFreshness(venue.latestContributorAt, now);
  }
  return formatPintDatasetAsOf();
}
