import { selectedComparableVenuePint, type ComparablePintVenue } from "@/lib/comparableVenuePint";
import { pintObservationTime } from "@/lib/comparablePint.mjs";
import { DRINK_MEASURE_LABEL, statedDrinkMeasure } from "@/lib/drinkMeasure";
import { formatDrinkTagName } from "@/lib/drinkTagName";
import { namedLegacyPintPriceSource } from "@/lib/legacyPriceEvidence.mjs";
import { londonDayKey } from "@/lib/londonHour";

export type VenuePriceEvidence = {
  priceGbp: number;
  drinkLabel: string | null;
  servingSize: string | null;
  publisher: { label: string; url: string | null } | null;
  sourceKind: "listed" | "reported";
  observedAt: string | null;
  observedOn: string | null;
};

/** Read only the evidence belonging to the amount this surface selected. */
export function venuePriceEvidence(
  venue: ComparablePintVenue,
  priceGbp: number,
  allowVenueContributor: boolean,
): VenuePriceEvidence {
  const empty: VenuePriceEvidence = {
    priceGbp, drinkLabel: null, servingSize: null, publisher: null, sourceKind: "listed",
    observedAt: null, observedOn: null,
  };
  const selected = selectedComparableVenuePint(venue, null, allowVenueContributor);
  if (!selected || selected.cheapestPrice !== priceGbp) return empty;

  const contributor = allowVenueContributor && venue.latestContributorPrice != null;
  const row = !contributor && !venue.sourcedPrice
    ? venue.prices?.find((price) => price.price_gbp === priceGbp)
    : undefined;
  const named = row ? namedLegacyPintPriceSource(row) : null;
  const sourceLabel = selected.priceSource?.trim();
  const measure = statedDrinkMeasure("measure" in selected ? selected.measure : null);
  const read = pintObservationTime(selected.priceObservedAt);
  const observedAt = read === null ? null : selected.priceObservedAt ?? null;
  const drinkLabel = "cheapestPint" in selected ? selected.cheapestPint?.trim() : null;
  return {
    priceGbp,
    drinkLabel: drinkLabel ? formatDrinkTagName(drinkLabel) : null,
    servingSize: measure ? DRINK_MEASURE_LABEL[measure] : null,
    publisher: named ?? (sourceLabel ? { label: sourceLabel, url: null } : null),
    sourceKind: contributor ? "reported" : "listed",
    observedAt,
    observedOn: read === null ? null : londonDayKey(new Date(read)),
  };
}
