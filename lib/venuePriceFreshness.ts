import { formatPintDatasetAsOf } from "@/lib/dataFreshness";
import {
  namedLegacyPintPriceSource,
  type LegacyPintPrice,
} from "@/lib/drinks";
import { firstHttp } from "@/lib/httpUrl";
import { formatFreshness, formatObservedAt } from "@/lib/venues";
import type { VenueKind } from "@/lib/venues";
import { isPubVenueKind } from "@/lib/venueKindFilters";

type VenuePriceFreshnessInput = Readonly<{
  cheapestPrice: number | null;
  latestContributorPrice: number | null;
  latestContributorAt: string | null;
  sourcedPrice?: Readonly<{
    observedAt: string;
    sourceLabel?: string;
    sourceUrl?: string;
  }> | null;
  prices?: readonly LegacyPintPrice[];
  kind?: VenueKind;
  anchorLabel?: string;
  anchorObservedAt?: string;
  anchorSourceUrl?: string;
}>;

export type VenuePriceCaption = Readonly<{
  label: string;
  href: string | null;
  freshness: string;
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

/** Identify the visible price lane without hiding its observation clock. */
export function venuePriceCaption(
  venue: VenuePriceFreshnessInput,
  now: Date = new Date(),
): VenuePriceCaption {
  const freshness = venuePriceFreshnessLabel(venue, now);
  if (venue.sourcedPrice) {
    return {
      label: venue.sourcedPrice.sourceLabel ?? "Sourced price",
      href: venue.sourcedPrice.sourceUrl ?? null,
      freshness,
    };
  }
  if (!isPubVenueKind(venue.kind) && venue.anchorObservedAt) {
    return {
      label: venue.anchorLabel ?? "Venue price",
      href: firstHttp(venue.anchorSourceUrl) || null,
      freshness,
    };
  }
  if (
    venue.latestContributorAt
    && venue.latestContributorPrice === venue.cheapestPrice
  ) {
    return {
      label: "Contributor price",
      href: null,
      freshness,
    };
  }
  const baselinePrice = venue.prices?.find(
    (price) => price.price_gbp === venue.cheapestPrice,
  );
  const baselineSource = baselinePrice
    ? namedLegacyPintPriceSource(baselinePrice)
    : null;
  if (baselineSource) {
    return {
      label: baselineSource.label,
      href: baselineSource.url,
      freshness,
    };
  }
  return {
    label: "Publisher not recorded",
    href: null,
    freshness,
  };
}
