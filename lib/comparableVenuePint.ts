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
export function comparableVenuePint(
  venue: ComparablePintVenue,
  signal?: { latestContributorPrice: number | null; latestContributorAt?: number | null } | null,
  allowVenueContributor = true,
): number | null {
  if (!isPubVenueKind(venue.kind) && !(venue.kind === "bar" && venue.legacyOsmBar === true)) {
    return null;
  }
  const price = signal?.latestContributorPrice ??
    (allowVenueContributor ? venue.latestContributorPrice : null);
  if (price != null) {
    const at = signal?.latestContributorPrice != null
      ? signal.latestContributorAt
      : venue.latestContributorAt;
    const observed = typeof at === "number" && Number.isFinite(new Date(at).getTime())
      ? new Date(at).toISOString()
      : at;
    return comparablePint({
      cheapestPrice: price,
      priceSource: "Corroborated Pint Drop",
      priceObservedAt: observed,
    });
  }
  const sourced = venue.sourcedPrice;
  if (sourced) return comparablePint({
    cheapestPrice: venue.cheapestPrice,
    priceSource: sourced.sourceLabel,
    priceObservedAt: sourced.observedAt,
  });
  const evidence = venue.prices?.length ? legacyCheapestPriceEvidence(venue.prices, venue.cheapestPrice) : {};
  const slimEvidence = venue.priceSource !== undefined || venue.priceObservedAt !== undefined;
  return comparablePint({
    cheapestPrice: venue.cheapestPrice,
    priceSource: slimEvidence ? venue.priceSource : evidence.priceSource,
    priceObservedAt: slimEvidence ? venue.priceObservedAt : evidence.priceObservedAt,
    anchorLabel: venue.anchorLabel,
    cheapestPint: evidence.cheapestPint ?? venue.cheapestPint,
    measure: evidence.measure ?? venue.measure,
  });
}
