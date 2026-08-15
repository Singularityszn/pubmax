import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { DRINK_BRANDS, haystackMatchesBrand } from "@/lib/drinkBrands";
import { namedLegacyPintPriceSource } from "@/lib/drinks";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue, VenuePrice } from "@/lib/venues";

export const DRINK_BRAND_LANDING_PUBLICATION_FLOOR = 20;
export const DRINK_BRAND_LANDING_ROW_LIMIT = 20;

type DrinkBrandLandingPublisher = NonNullable<
  ReturnType<typeof namedLegacyPintPriceSource>
>;

export type DrinkBrandLandingRow = {
  rank: number;
  venueId: string;
  venueName: string;
  borough: string;
  pintName: string;
  priceGbp: number;
  publisher: DrinkBrandLandingPublisher | null;
};

export type DrinkBrandLanding = {
  slug: string;
  brandLabel: string;
  collectedAt: string;
  totalPricedVenues: number;
  rows: DrinkBrandLandingRow[];
};

function comparePriceRows(left: VenuePrice, right: VenuePrice): number {
  return (
    (typeof left.price_gbp === "number" ? left.price_gbp : Number.POSITIVE_INFINITY) -
      (typeof right.price_gbp === "number" ? right.price_gbp : Number.POSITIVE_INFINITY) ||
    left.app_price_id.localeCompare(right.app_price_id) ||
    left.pint_name.localeCompare(right.pint_name)
  );
}

function validMatchingPriceRows(venue: Venue, brand: (typeof DRINK_BRANDS.beer)[number]): VenuePrice[] {
  return venue.prices.filter(
    (row) =>
      typeof row.pint_name === "string" &&
      typeof row.price_gbp === "number" &&
      Number.isFinite(row.price_gbp) &&
      row.price_gbp > 0 &&
      haystackMatchesBrand(row.pint_name, brand),
  );
}

export function buildDrinkBrandLanding(
  slug: string,
  venues: readonly Venue[],
  options: { publicationFloor?: number; rowLimit?: number } = {},
): DrinkBrandLanding | null {
  const brand = DRINK_BRANDS.beer.find((candidate) => candidate.id === slug);
  if (!brand) return null;

  const publicationFloor = options.publicationFloor ?? DRINK_BRAND_LANDING_PUBLICATION_FLOOR;
  const rowLimit = options.rowLimit ?? DRINK_BRAND_LANDING_ROW_LIMIT;
  const candidates = venues.flatMap((venue) => {
    if (!isPubVenueKind(venue.kind)) return [];
    const selected = validMatchingPriceRows(venue, brand).sort(comparePriceRows)[0];
    if (!selected || typeof selected.price_gbp !== "number") return [];
    return [
      {
        venueId: venue.id,
        venueName: venue.name,
        borough: venue.primaryBorough,
        pintName: selected.pint_name,
        priceGbp: selected.price_gbp,
        publisher: namedLegacyPintPriceSource(selected),
      },
    ];
  });

  if (candidates.length < publicationFloor) return null;

  const ranked = candidates
    .sort(
      (left, right) =>
        left.priceGbp - right.priceGbp ||
        left.venueName.localeCompare(right.venueName) ||
        left.venueId.localeCompare(right.venueId),
    )
    .slice(0, rowLimit);

  return {
    slug: brand.id,
    brandLabel: brand.label,
    collectedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
    totalPricedVenues: candidates.length,
    rows: ranked.map((row, index) => ({ ...row, rank: index + 1 })),
  };
}

export function listDrinkBrandLandings(venues: readonly Venue[]): DrinkBrandLanding[] {
  return DRINK_BRANDS.beer.flatMap((brand) => {
    const landing = buildDrinkBrandLanding(brand.id, venues);
    return landing ? [landing] : [];
  });
}
