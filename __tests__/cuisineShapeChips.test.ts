import { describe, expect, it } from "vitest";

import { nextCuisineShapeFilters } from "@/components/map/CuisineShapeChips";
import type { Filters } from "@/lib/venues";

function filters(overrides: Partial<Filters> = {}): Filters {
  return {
    query: "",
    maxPrice: 100,
    crawlStyle: "balanced",
    stopCount: 4,
    routeWindow: 90,
    requireBeerGarden: false,
    requireNonAlcoholic: false,
    requireLiveSports: false,
    requireFood: false,
    requireCocktails: false,
    requireWater: false,
    requireHeritage: false,
    requirePintDrops: false,
    canonicalOnly: false,
    requireStepFree: false,
    requireAccessibleToilet: false,
    requireSeatedService: false,
    drinkCategory: "",
    drinkBrand: "",
    cuisineTag: "",
    ...overrides,
  };
}

describe("nextCuisineShapeFilters", () => {
  it("sets cuisineTag and requireFood when a cuisine chip is selected", () => {
    expect(nextCuisineShapeFilters(filters(), "pizza")).toMatchObject({
      cuisineTag: "pizza",
      requireFood: true,
    });
  });

  it("clears cuisineTag and requireFood when the active chip is toggled off", () => {
    expect(
      nextCuisineShapeFilters(filters({ cuisineTag: "burger", requireFood: true }), "burger"),
    ).toMatchObject({
      cuisineTag: "",
      requireFood: false,
    });
  });

  it("switches between cuisine chips without double-toggling", () => {
    const result = nextCuisineShapeFilters(
      filters({ cuisineTag: "pizza", requireFood: true }),
      "roast",
    );
    expect(result.cuisineTag).toBe("roast");
    expect(result.requireFood).toBe(true);
  });

  it("clears drink lens when a cuisine chip is selected", () => {
    expect(
      nextCuisineShapeFilters(
        filters({ drinkCategory: "beer", drinkBrand: "guinness", requireCocktails: false }),
        "tapas",
      ),
    ).toMatchObject({
      cuisineTag: "tapas",
      requireFood: true,
      drinkCategory: "",
      drinkBrand: "",
      requireCocktails: false,
    });
  });

  it("clears requireCocktails when a cuisine chip is selected", () => {
    expect(
      nextCuisineShapeFilters(
        filters({ drinkCategory: "cocktail", requireCocktails: true }),
        "steak",
      ),
    ).toMatchObject({
      cuisineTag: "steak",
      requireFood: true,
      drinkCategory: "",
      requireCocktails: false,
    });
  });

  it("leaves text query untouched when selecting a cuisine chip", () => {
    expect(
      nextCuisineShapeFilters(filters({ query: "Shoreditch" }), "gastropub"),
    ).toMatchObject({
      query: "Shoreditch",
      cuisineTag: "gastropub",
    });
  });

  it("leaves text query untouched when toggling off a cuisine chip", () => {
    expect(
      nextCuisineShapeFilters(
        filters({ query: "Soho", cuisineTag: "pizza", requireFood: true }),
        "pizza",
      ),
    ).toMatchObject({
      query: "Soho",
      cuisineTag: "",
      requireFood: false,
    });
  });
});
