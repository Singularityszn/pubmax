import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import {
  buildDrinkBrandLanding,
  drinkBrandCandidateForVenue,
  findDrinkBrandLandingBrand,
  listDrinkBrandLandings,
} from "@/lib/drinkBrandLanding";
import type { DrinkBrand } from "@/lib/drinkBrands";
import { NIGHT_AREAS, type NightArea, type NightAreaSlug } from "@/lib/nightAreas";
import {
  PRICED_LANDING_PUBLICATION_FLOORS,
  assignVenueToNightArea,
  nightAreaPublishesPrices,
  publishablePricedRows,
  type PricedLandingCandidate,
  type PricedLandingRow,
} from "@/lib/pricedLanding";
import type { Venue } from "@/lib/venues";

export const DRINK_BRAND_AREA_PUBLICATION_FLOOR =
  PRICED_LANDING_PUBLICATION_FLOORS["drink-brand-area"];

export type DrinkBrandAreaLanding = {
  areaSlug: NightAreaSlug;
  areaName: string;
  brandSlug: string;
  brandLabel: string;
  collectedAt: string;
  totalPricedVenues: number;
  rows: [PricedLandingRow, ...PricedLandingRow[]];
};

function areaBrandCandidates(
  area: NightArea,
  brand: DrinkBrand,
  venues: readonly Venue[],
  areas: readonly NightArea[],
): PricedLandingCandidate[] {
  return venues.flatMap((venue) => {
    if (assignVenueToNightArea(venue, areas)?.slug !== area.slug) return [];
    const candidate = drinkBrandCandidateForVenue(venue, brand);
    return candidate ? [candidate] : [];
  });
}

/**
 * One pair, for a brand whose own London page is already known to publish.
 *
 * The area floor is 10 and the brand floor is 20, so a brand can clear an area
 * and miss London. This page's parent crumb is that London page, and the route
 * sets `dynamicParams = false`, so publishing the pair anyway would render a
 * crumb onto a 404. Every caller answers the parent question first.
 */
function publishedBrandAreaLanding(
  area: NightArea,
  brand: DrinkBrand,
  venues: readonly Venue[],
  areas: readonly NightArea[],
): DrinkBrandAreaLanding | null {
  if (!nightAreaPublishesPrices(area)) return null;

  const published = publishablePricedRows(
    "drink-brand-area",
    areaBrandCandidates(area, brand, venues, areas),
  );
  if (!published) return null;

  return {
    areaSlug: area.slug,
    areaName: area.name,
    brandSlug: brand.id,
    brandLabel: brand.label,
    collectedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
    totalPricedVenues: published.totalPricedVenues,
    rows: published.rows,
  };
}

export function buildDrinkBrandAreaLanding(
  areaSlug: string,
  brandSlug: string,
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
): DrinkBrandAreaLanding | null {
  const area = areas.find((candidate) => candidate.slug === areaSlug);
  const brand = findDrinkBrandLandingBrand(brandSlug);
  if (!area || !brand) return null;
  if (!buildDrinkBrandLanding(brand.id, venues)) return null;

  return publishedBrandAreaLanding(area, brand, venues, areas);
}

/**
 * The publishing pairs for ONE brand, in area order.
 *
 * The brand page lists its own sibling areas, and building every brand's pairs
 * to discard all but one sweeps the whole priced-venue list once per brand on
 * every request to a dynamic route.
 */
export function listDrinkBrandAreaLandingsForBrand(
  brandSlug: string,
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
): DrinkBrandAreaLanding[] {
  const brand = findDrinkBrandLandingBrand(brandSlug);
  if (!brand || !buildDrinkBrandLanding(brand.id, venues)) return [];
  return areas.flatMap((area) => {
    const landing = publishedBrandAreaLanding(area, brand, venues, areas);
    return landing ? [landing] : [];
  });
}

/**
 * Every pair that publishes, brand page by brand page. The brands come from
 * the published London pages rather than the catalogue, so the parent question
 * is asked once per brand instead of once per pair.
 */
export function listDrinkBrandAreaLandings(
  venues: readonly Venue[],
  areas: readonly NightArea[] = NIGHT_AREAS,
): DrinkBrandAreaLanding[] {
  const publishedBrands = listDrinkBrandLandings(venues).flatMap((landing) => {
    const brand = findDrinkBrandLandingBrand(landing.slug);
    return brand ? [brand] : [];
  });
  return areas.flatMap((area) =>
    publishedBrands.flatMap((brand) => {
      const landing = publishedBrandAreaLanding(area, brand, venues, areas);
      return landing ? [landing] : [];
    }),
  );
}
