import { isValidObservedAt } from "@/lib/priceUpdateRowShape";
import { isNationalBaseVenueId, venueIdMatchesCity } from "@/lib/cityVenueIds";
import { priceStandingFor } from "@/lib/priceTier";
import { BUNDLE_DEFAULT_CATEGORY, bundlePricesForCategory, type UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { venueBundlePrices, venuePriceLane, venuePriceLaneObservedGbp, venueSourcedPrice } from "@/lib/venuePriceLane";
import { hasPintPriceSemantics, type Venue } from "@/lib/venues";

export function projectMapPintPrices(
  venues: Venue[],
  rowsByVenue: ReadonlyMap<string, readonly UkPriceBundleRow[]>,
  signals: ReadonlyMap<string, { latestContributorPrice?: number | null; latestContributorAt?: number | null }>,
  cityId: string,
  now = Date.now(),
  favoritePint: string | null = null,
): Venue[] {
  if (cityId !== "london" || favoritePint) return venues;
  return venues.map((venue) => {
    if (!venueIdMatchesCity(venue.id, "london") || isNationalBaseVenueId(venue.id)
      || !hasPintPriceSemantics(venue)) return venue;
    const rows = rowsByVenue.get(venue.id);
    const bundle = rows
      ? bundlePricesForCategory(rows.filter((row) =>
          row.venueId === venue.id && isValidObservedAt(row.observedAt, now)), BUNDLE_DEFAULT_CATEGORY)
      : venueBundlePrices(venue);
    const listed = priceStandingFor({ listed: bundle.listed }, now).standing === "listed"
      ? bundle.listed : null;
    const signal = signals.get(venue.id);
    const lane = venuePriceLane(venue,
      signal?.latestContributorPrice ?? venue.latestContributorPrice,
      venueSourcedPrice(venue), { listed }, undefined, undefined, undefined, now);
    if (!lane || !["listed", "sourced", "contributor"].includes(lane.lane)) return venue;
    const price = venuePriceLaneObservedGbp(lane);
    if (price === null) return venue;
    const observedAt = lane.lane === "listed" ? lane.listed.observedAt
      : lane.lane === "sourced" ? lane.sourcedPrice.observedAt
        : signal?.latestContributorAt != null ? new Date(signal.latestContributorAt).toISOString() : venue.latestContributorAt;
    return {
      ...venue,
      bundlePrices: { ...bundle, listed },
      cheapestPrice: price,
      cheapestPint: "",
      priceBand: undefined,
      priceObservedAt: observedAt ?? venue.priceObservedAt,
    };
  });
}
