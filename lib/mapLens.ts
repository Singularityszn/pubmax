import type { Filters } from "@/lib/venues";

/**
 * Returns true when any food or drink lens filter is active — meaning the map
 * should surface only matching pubs and hide landmarks / ambient POI layers
 * (historic sites, viewpoints, parks dots) to avoid tourist noise drowning out
 * the filtered results.
 *
 * Transit layers (Tube, Rail, bus) are intentionally excluded from the lens:
 * they help with navigation and are left at whatever visibility the user chose
 * in the Layers control.
 */
export function isMapLensActive(
  filters: Pick<
    Filters,
    "drinkCategory" | "cuisineTag" | "requireFood" | "requireCocktails" | "requireNonAlcoholic"
  >,
): boolean {
  return Boolean(
    filters.drinkCategory ||
      filters.cuisineTag ||
      filters.requireFood ||
      filters.requireCocktails ||
      filters.requireNonAlcoholic,
  );
}
