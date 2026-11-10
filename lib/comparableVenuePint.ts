import { comparablePint } from "@/lib/comparablePint.mjs";
import { legacyCheapestPriceEvidence, type LegacyPriceEvidenceRow } from "@/lib/legacyPriceEvidence.mjs";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import type { MapLensPrice } from "@/lib/mapExperienceLens";

export type ComparablePintVenue = Pick<Venue, "cheapestPrice"> & Partial<Pick<Venue,
  "kind" | "legacyOsmBar" | "priceSource" | "priceObservedAt" |
  "anchorLabel" | "latestContributorPrice" | "latestContributorAt"
  | "cheapestPint" | "measure"
>> & { prices?: readonly LegacyPriceEvidenceRow[]; sourcedPrice?: { sourceLabel: string; observedAt: string } | null };

export function selectedVenuePintEvidence(venue: ComparablePintVenue, now?: number) {
  return venue.prices?.some(({ price_gbp }) => price_gbp != null)
    ? legacyCheapestPriceEvidence(venue.prices, venue.cheapestPrice, now)
    : {
        priceSource: venue.priceSource,
        priceObservedAt: venue.priceObservedAt,
        cheapestPint: venue.cheapestPint,
        measure: venue.measure,
      };
}

/** Other drink lenses retain their own serving and ranking rules. */
export function comparableLensPrice(price: MapLensPrice, venue: Venue): number | null {
  if (price.category !== "beer") return price.priceGbp;
  const at = price.observedAt ?? (
    typeof price.submittedAt === "number" && Number.isFinite(new Date(price.submittedAt).getTime())
      ? new Date(price.submittedAt).toISOString()
      : undefined
  );
  return comparablePint({
    cheapestPrice: price.priceGbp,
    priceSource: price.source === "community" ? "Corroborated community price" : price.sourceUrl,
    priceObservedAt: at,
    anchorLabel: price.source === "sourced-anchor" ? venue.anchorLabel : undefined,
  });
}

/** Compare the selected figure with evidence belonging to that same figure. */
export function selectedComparableVenuePint(
  venue: ComparablePintVenue,
  signal?: { latestContributorPrice: number | null; latestContributorAt?: number | null } | null,
  allowVenueContributor = true,
  now?: number,
) {
  if (!isPubVenueKind(venue.kind) && !(venue.kind === "bar" && venue.legacyOsmBar === true)) {
    return null;
  }
  const price = signal?.latestContributorPrice ??
    (allowVenueContributor ? venue.latestContributorPrice : null);
  if (price != null) {
    const at = signal?.latestContributorPrice != null
      ? signal.latestContributorAt
      : venue.latestContributorAt;
    const observed = typeof at === "number"
      ? Number.isFinite(new Date(at).getTime()) ? new Date(at).toISOString() : null
      : at;
    return {
      cheapestPrice: price,
      priceSource: "Corroborated Pint Drop",
      priceObservedAt: observed,
    };
  }
  const sourced = venue.sourcedPrice;
  if (sourced) return {
    cheapestPrice: venue.cheapestPrice,
    priceSource: sourced.sourceLabel,
    priceObservedAt: sourced.observedAt,
  };
  return {
    cheapestPrice: venue.cheapestPrice,
    ...selectedVenuePintEvidence(venue, now),
    anchorLabel: venue.anchorLabel,
  };
}

/** Compare the selected figure with its own complete evidence. */
export function comparableVenuePint(
  venue: ComparablePintVenue,
  signal?: { latestContributorPrice: number | null; latestContributorAt?: number | null } | null,
  allowVenueContributor = true,
  now?: number,
): number | null {
  const selected = selectedComparableVenuePint(venue, signal, allowVenueContributor, now);
  return selected ? comparablePint(selected, now) : null;
}
