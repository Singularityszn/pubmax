import { formatObservedDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { namedLegacyPintPriceSource } from "@/lib/drinks";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

export const DRINK_LANDING_CATEGORIES = ["beer"] as const;
export type DrinkLandingCategory = (typeof DRINK_LANDING_CATEGORIES)[number];

export const DRINK_LANDING_PUBLICATION_FLOOR = 20;
export const DRINK_LANDING_ROW_LIMIT = 20;

export type DrinkLandingPublisher = {
  label: string;
  url: string;
};

export type DrinkLandingRow = {
  venueId: string;
  name: string;
  borough: string;
  priceGbp: number;
  pintName: string;
  publisher: DrinkLandingPublisher | null;
};

export type DrinkLandingModel = {
  category: DrinkLandingCategory;
  categoryLabel: string;
  totalPricedVenues: number;
  collectedLabel: string;
  rows: DrinkLandingRow[];
};

type DrinkLandingOptions = {
  publicationFloor?: number;
  rowLimit?: number;
};

export function isDrinkLandingCategory(value: string): value is DrinkLandingCategory {
  return (DRINK_LANDING_CATEGORIES as readonly string[]).includes(value);
}

function exactBeerRow(venue: Venue): DrinkLandingRow | null {
  if (!isPubVenueKind(venue.kind)) return null;
  const price = venue.cheapestPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  const exact = venue.prices.find((row) => row.price_gbp === price);
  if (!exact) return null;
  const publisher = namedLegacyPintPriceSource(exact);
  return {
    venueId: venue.id,
    name: venue.name,
    borough: venue.primaryBorough,
    priceGbp: price,
    pintName: exact.pint_name.trim() || "Pint",
    publisher: publisher ? { label: publisher.label, url: publisher.url } : null,
  };
}

function compareRows(left: DrinkLandingRow, right: DrinkLandingRow): number {
  return (
    left.priceGbp - right.priceGbp ||
    left.name.localeCompare(right.name, "en-GB") ||
    left.venueId.localeCompare(right.venueId, "en-GB")
  );
}

/** Build one publishable acquisition answer from governed Venue Dataset rows. */
export function buildDrinkLandingModel(
  category: string,
  venues: readonly Venue[],
  options: DrinkLandingOptions = {},
): DrinkLandingModel | null {
  if (!isDrinkLandingCategory(category)) return null;
  const publicationFloor = Math.max(
    1,
    options.publicationFloor ?? DRINK_LANDING_PUBLICATION_FLOOR,
  );
  const rowLimit = Math.max(1, options.rowLimit ?? DRINK_LANDING_ROW_LIMIT);
  const eligible = venues.flatMap((venue) => {
    const row = exactBeerRow(venue);
    return row ? [row] : [];
  });
  if (eligible.length < publicationFloor) return null;
  eligible.sort(compareRows);
  return {
    category,
    categoryLabel: "Beer",
    totalPricedVenues: eligible.length,
    collectedLabel: `Prices last collected ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}.`,
    rows: eligible.slice(0, rowLimit),
  };
}
