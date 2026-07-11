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
    cuisineTag: "",
    ...overrides,
  };
}

describe("nextDrinkShapeFilters", () => {
  it("sets the drink lens and clears a stale brand when a shape is selected (leaves text query alone)", () => {
    expect(
      nextDrinkShapeFilters(
        filters({ query: "Guinness", drinkCategory: "beer", drinkBrand: "guinness" }),
        "wine",
      ),
    ).toMatchObject({
      query: "Guinness",
      requireCocktails: false,
      drinkCategory: "wine",
      drinkBrand: "",
    });
  });

  it("clears drink lens filters when the active shape is toggled off (leaves text query alone)", () => {
    expect(
      nextDrinkShapeFilters(
        filters({ query: "borough", drinkCategory: "gin", drinkBrand: "sipsmith" }),
        "gin",
      ),
    ).toMatchObject({
      query: "borough",
      requireCocktails: false,
      drinkCategory: "",
      drinkBrand: "",
    });
  });

  it("keeps cocktail amenity in sync with the cocktail shape", () => {
    expect(nextDrinkShapeFilters(filters(), "cocktail")).toMatchObject({
      query: "",
      requireCocktails: true,
      drinkCategory: "cocktail",
      drinkBrand: "",
    });
  });

  it("clears an active cuisineTag and requireFood when a drink shape is selected", () => {
    expect(
      nextDrinkShapeFilters(
        filters({ cuisineTag: "pizza", requireFood: true }),
        "beer",
      ),
    ).toMatchObject({
      drinkCategory: "beer",
      cuisineTag: "",
      requireFood: false,
    });
  });

  it("does not clear cuisineTag when the same drink chip is toggled off", () => {
    // Toggle-off path: clears drink lens but does not touch cuisineTag
    // (deactivating drinks shouldn't silently wipe an unrelated food filter).
    const result = nextDrinkShapeFilters(
      filters({ drinkCategory: "wine", cuisineTag: "burger" }),
      "wine",
    );
    expect(result.drinkCategory).toBe("");
    expect(result.cuisineTag).toBe("burger");
  });
});
