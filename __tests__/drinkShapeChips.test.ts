import { describe, expect, it } from "vitest";

import { nextDrinkShapeFilters } from "@/components/map/DrinkShapeChips";
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
    ...overrides,
  };
}

describe("nextDrinkShapeFilters", () => {
  it("sets the drink lens and clears a stale brand when a shape is selected", () => {
    expect(
      nextDrinkShapeFilters(
        filters({ query: "Guinness", drinkCategory: "beer", drinkBrand: "guinness" }),
        "wine",
      ),
    ).toMatchObject({
      query: "Wine",
      requireCocktails: false,
      drinkCategory: "wine",
      drinkBrand: "",
    });
  });

  it("clears both visible and hidden drink filters when the active shape is toggled off", () => {
    expect(
      nextDrinkShapeFilters(
        filters({ query: "Gin", drinkCategory: "gin", drinkBrand: "sipsmith" }),
        "gin",
      ),
    ).toMatchObject({
      query: "",
      requireCocktails: false,
      drinkCategory: "",
      drinkBrand: "",
    });
  });

  it("keeps cocktail amenity in sync with the cocktail shape", () => {
    expect(nextDrinkShapeFilters(filters(), "cocktail")).toMatchObject({
      query: "Cocktails",
      requireCocktails: true,
      drinkCategory: "cocktail",
      drinkBrand: "",
    });
  });
});
