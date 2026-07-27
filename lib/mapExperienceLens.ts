import {
  drivesMap,
  mapCandidateOf,
  NO_ALCOHOL_DRINK_CATEGORIES,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { CATEGORY_META, type DrinkCategory } from "@/lib/drinks";
import { compactVenueAnchor } from "@/lib/venueAnchorPresentation";
import type { Filters, Venue } from "@/lib/venues";

export type MapExperienceLens = "all" | "no-alcohol" | "food";
export type NoAlcoholDrinkCategory = Extract<
  DrinkCategory,
  "soft-drink" | "alcohol-free"
>;

export type MapLensPrice = {
  venueId: string;
  category: DrinkCategory | null;
  categoryLabel: string;
  priceGbp: number;
  submittedAt?: number;
  observedAt?: string;
  source: "community" | "sourced-anchor";
  sourceUrl?: string;
};

/** Pint and brand refinements cannot answer a category-price lens. */
export function filtersForDrinkPriceLens(
  filters: Filters,
  category: DrinkCategory | null,
): Filters {
  if (category === null || category === "beer") return filters;
  return {
    ...filters,
    maxPrice: Number.POSITIVE_INFINITY,
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    requireCocktails: false,
  };
}

/**
 * Trusted map price for one selected drink category per venue. The map
 * candidate, corroboration floor and max-age window are the same gates beer
 * already uses. Keeping this outside VenueSignal prevents a whisky figure from
 * ever becoming pint authority.
 */
export function trustedDrinkLensPrices(
  rowsByVenue: ReadonlyMap<string, readonly CommunityPrice[]>,
  category: DrinkCategory,
  now: number = Date.now(),
): Map<string, MapLensPrice> {
  const out = new Map<string, MapLensPrice>();
  for (const [venueId, rows] of rowsByVenue) {
    const row = rows.find((candidate) => candidate.drinkCategory === category);
    if (!row) continue;
    const candidate = mapCandidateOf(row);
    if (!drivesMap(candidate, now)) continue;
    out.set(venueId, {
      venueId,
      category,
      categoryLabel: CATEGORY_META[category].label,
      priceGbp: candidate.priceGbp,
      submittedAt: candidate.submittedAt,
      source: "community",
    });
  }
  return out;
}

/**
 * Pint and drink refinements are invisible while an experience view owns the
 * map, so they must also be inert. Place search and general venue facets remain.
 */
export function filtersForExperienceLens(
  filters: Filters,
  lens: MapExperienceLens,
): Filters {
  if (lens === "all") return filters;
  return {
    ...filters,
    maxPrice: Number.POSITIVE_INFINITY,
    zone: "",
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    requireCocktails: false,
    requirePintDrops: false,
  };
}

function noAlcoholCategory(
  value: DrinkCategory,
): value is NoAlcoholDrinkCategory {
  return (NO_ALCOHOL_DRINK_CATEGORIES as readonly DrinkCategory[]).includes(
    value,
  );
}

/**
 * One name per category, taken from the same table the submit chips read, so a
 * price logged under "Soft drinks" comes back saying "Soft drinks" everywhere.
 */
function noAlcoholLabel(category: NoAlcoholDrinkCategory): string {
  return CATEGORY_META[category].label;
}

/**
 * Best trusted no-alcohol price per venue. Every category has to earn the same
 * corroboration and age gates as beer, but the result stays outside pint
 * VenueSignal state.
 */
export function trustedNoAlcoholLensPrices(
  rowsByVenue: ReadonlyMap<string, readonly CommunityPrice[]>,
  now: number = Date.now(),
): Map<string, MapLensPrice> {
  const out = new Map<string, MapLensPrice>();
  for (const [venueId, rows] of rowsByVenue) {
    let best: MapLensPrice | null = null;
    for (const row of rows) {
      if (!noAlcoholCategory(row.drinkCategory)) continue;
      const candidate = mapCandidateOf(row);
      if (!drivesMap(candidate, now)) continue;
      const next: MapLensPrice = {
        venueId,
        category: row.drinkCategory,
        categoryLabel: noAlcoholLabel(row.drinkCategory),
        priceGbp: candidate.priceGbp,
        submittedAt: candidate.submittedAt,
        source: "community",
      };
      if (
        !best ||
        next.priceGbp < best.priceGbp ||
        (next.priceGbp === best.priceGbp &&
          (next.submittedAt ?? 0) > (best.submittedAt ?? 0))
      ) {
        best = next;
      }
    }
    if (best) out.set(venueId, best);
  }
  return out;
}

function isFoodKind(venue: Venue): boolean {
  return venue.kind === "food" || venue.kind === "restaurant";
}

function hasKnownNoAlcoholService(venue: Venue): boolean {
  return (
    venue.amenities.nonAlcoholic ||
    venue.filterHints?.amenities.nonAlcoholic === true
  );
}

export function filterVenuesForExperienceLens(
  venues: readonly Venue[],
  lens: MapExperienceLens,
  noAlcoholPrices: ReadonlyMap<string, MapLensPrice>,
): Venue[] {
  if (lens === "all") return [...venues];
  if (lens === "food") return venues.filter(isFoodKind);
  return venues.filter(
    (venue) =>
      isFoodKind(venue) ||
      hasKnownNoAlcoholService(venue) ||
      noAlcoholPrices.has(venue.id),
  );
}

function sourcedAnchorPrice(venue: Venue): MapLensPrice | null {
  const anchor = compactVenueAnchor(venue);
  const price = venue.cheapestPrice;
  if (
    !anchor ||
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }
  return {
    venueId: venue.id,
    category: null,
    categoryLabel: anchor.label,
    priceGbp: price,
    observedAt: venue.anchorObservedAt,
    source: "sourced-anchor",
    sourceUrl: anchor.sourceUrl,
  };
}

export function lensPriceForVenue(
  venue: Venue,
  lens: MapExperienceLens,
  noAlcoholPrices: ReadonlyMap<string, MapLensPrice>,
): MapLensPrice | null {
  if (lens === "all") return null;
  if (lens === "no-alcohol") {
    const community = noAlcoholPrices.get(venue.id);
    if (community) return community;
  }
  return isFoodKind(venue) ? sourcedAnchorPrice(venue) : null;
}

export function lensPricesForVenues(
  venues: readonly Venue[],
  lens: MapExperienceLens,
  noAlcoholPrices: ReadonlyMap<string, MapLensPrice>,
): Map<string, MapLensPrice> {
  const prices = new Map<string, MapLensPrice>();
  for (const venue of venues) {
    const price = lensPriceForVenue(venue, lens, noAlcoholPrices);
    if (price) prices.set(venue.id, price);
  }
  return prices;
}

/**
 * "We could not check" and "we checked part of it" are two different findings,
 * and the summary may never merge them: a partial read has already painted
 * trusted figures, so borrowing the failure sentence would call the prices on
 * the map unchecked.
 */
export type NoAlcoholIndexStatus =
  | "idle"
  | "loading"
  | "ready"
  | "partial"
  | "degraded";

export function experienceLensSummary(
  lens: MapExperienceLens,
  noAlcoholPriceCount: number,
  sourcedFoodPriceCount: number,
  indexStatus: NoAlcoholIndexStatus,
): string {
  if (lens === "all") return "";
  if (lens === "food") {
    if (sourcedFoodPriceCount === 0) {
      return "Food venues shown. No sourced menu prices in this view yet.";
    }
    return `${sourcedFoodPriceCount} sourced menu price${
      sourcedFoodPriceCount === 1 ? "" : "s"
    } shown.`;
  }
  if (indexStatus === "loading" || indexStatus === "idle") {
    return "Checking soft-drink and alcohol-free prices. Food venues are already shown.";
  }
  if (indexStatus === "degraded") {
    return "Could not check no-alcohol prices right now. Food venues still show sourced menu prices.";
  }
  const plural = noAlcoholPriceCount === 1 ? "" : "s";
  if (indexStatus === "partial") {
    if (noAlcoholPriceCount === 0) {
      return "We read part of the no-alcohol prices and none of them are here. Food venues still show sourced menu prices.";
    }
    return `${noAlcoholPriceCount} no-alcohol price${plural} shown, read from part of the list. Food venues also show sourced menu prices.`;
  }
  if (noAlcoholPriceCount === 0) {
    return "No soft-drink or alcohol-free prices logged here yet. Food venues still show sourced menu prices.";
  }
  return `${noAlcoholPriceCount} no-alcohol price${plural} shown. Food venues also show sourced menu prices.`;
}
