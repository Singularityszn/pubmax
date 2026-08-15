import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { DRINK_BRANDS } from "@/lib/drinkBrands";
import {
  assignVenueToNightArea,
} from "@/lib/nightAreaLanding";
import {
  NIGHT_AREAS,
  isNightAreaRouteReady,
  type NightArea,
  type NightAreaSlug,
} from "@/lib/nightAreas";
import {
  namedLegacyPintPriceSource,
} from "@/lib/drinks";
import {
  selectDrinkBrandPriceForVenue,
  type DrinkBrandLandingRow,
} from "@/lib/drinkBrandLanding";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

export const DRINK_BRAND_AREA_PUBLICATION_FLOOR = 10;
export const DRINK_BRAND_AREA_ROW_LIMIT = 20;

export type DrinkBrandAreaLanding = {
  areaSlug: NightAreaSlug;
  areaName: string;
  brandSlug: string;
  brandLabel: string;
  collectedAt: string;
  totalPricedVenues: number;
  rows: [DrinkBrandLandingRow, ...DrinkBrandLandingRow[]];
};

function rankedBrandRows(
  area: NightArea,
  brand: (typeof DRINK_BRANDS.beer)[number],
  venues: readonly Venue[],
  areas: readonly NightArea[],
): Omit<DrinkBrandLandingRow, "rank">[] {
  const seenVenueIds = new Set<string>();
  return venues
    .flatMap((venue) => {
      if (seenVenueIds.has(venue.id) || !isPubVenueKind(venue.kind)) return [];
      if (assignVenueToNightArea(venue, areas)?.slug !== area.slug) return [];
      const selected = selectDrinkBrandPriceForVenue(venue, brand);
      if (!selected || typeof selected.price_gbp !== "number") return [];
      seenVenueIds.add(venue.id);
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
    })
    .sort(
      (left, right) =>
        left.priceGbp - right.priceGbp ||
        left.venueName.localeCompare(right.venueName) ||
        left.venueId.localeCompare(right.venueId),
    );
}

export function buildDrinkBrandAreaLanding(
  areaSlug: string,
  brandSlug: string,
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
  now = new Date(),
): DrinkBrandAreaLanding | null {
  const area = areas.find((candidate) => candidate.slug === areaSlug);
  const brand = DRINK_BRANDS.beer.find((candidate) => candidate.id === brandSlug);
  if (!area || !brand || !isNightAreaRouteReady(area, now)) return null;

  const ranked = rankedBrandRows(area, brand, venues, areas);
  if (ranked.length < DRINK_BRAND_AREA_PUBLICATION_FLOOR) return null;

  const rows = ranked
    .slice(0, DRINK_BRAND_AREA_ROW_LIMIT)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const [firstRow, ...restRows] = rows;
  if (!firstRow) return null;

  return {
    areaSlug: area.slug,
    areaName: area.name,
    brandSlug: brand.id,
    brandLabel: brand.label,
    collectedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
    totalPricedVenues: ranked.length,
    rows: [firstRow, ...restRows],
  };
}

export function listDrinkBrandAreaLandings(
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
  now = new Date(),
): DrinkBrandAreaLanding[] {
  return areas.flatMap((area) =>
    DRINK_BRANDS.beer.flatMap((brand) => {
      const landing = buildDrinkBrandAreaLanding(area.slug, brand.id, venues, areas, now);
      return landing ? [landing] : [];
    }),
  );
}
