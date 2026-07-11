import { describe, expect, it } from "vitest";

import {
  drinksPanelSearchLabel,
  foodPanelSearchLabel,
} from "@/components/map/MapToolbar";

// ── foodPanelSearchLabel ─────────────────────────────────────────────────────

describe("foodPanelSearchLabel", () => {
  it("returns 'Search map' when no food filter is active", () => {
    expect(foodPanelSearchLabel({ cuisineTag: "", requireFood: false }, 42)).toBe("Search map");
  });

  it("returns count-based label for active cuisine tag (plural)", () => {
    expect(foodPanelSearchLabel({ cuisineTag: "pizza", requireFood: true }, 14)).toBe(
      "Show 14 pizza pubs",
    );
  });

  it("returns singular label for count of 1", () => {
    expect(foodPanelSearchLabel({ cuisineTag: "tapas", requireFood: true }, 1)).toBe(
      "Show 1 tapas pub",
    );
  });

  it("returns 'No … pubs found' when cuisine active but count is zero", () => {
    expect(foodPanelSearchLabel({ cuisineTag: "steak", requireFood: true }, 0)).toBe(
      "No steak pubs found",
    );
  });

  it("returns fallback label when cuisine active but count is undefined", () => {
    expect(foodPanelSearchLabel({ cuisineTag: "burger", requireFood: true }, undefined)).toBe(
      "Show burger pubs",
    );
  });

  it("returns food count label when requireFood is set without a tag (plural)", () => {
    expect(foodPanelSearchLabel({ cuisineTag: "", requireFood: true }, 28)).toBe(
      "Show 28 food pubs",
    );
  });

  it("returns singular food label for count of 1", () => {
    expect(foodPanelSearchLabel({ cuisineTag: "", requireFood: true }, 1)).toBe(
      "Show 1 food pub",
    );
  });

  it("returns 'No food pubs found' when requireFood set but no matches", () => {
    expect(foodPanelSearchLabel({ cuisineTag: "", requireFood: true }, 0)).toBe(
      "No food pubs found",
    );
  });
});

// ── drinksPanelSearchLabel ───────────────────────────────────────────────────

describe("drinksPanelSearchLabel", () => {
  it("returns 'Search map' when no drink filter is active", () => {
    expect(
      drinksPanelSearchLabel({ drinkCategory: "", requireCocktails: false }, null, 99),
    ).toBe("Search map");
  });

  it("capitalises the category in the label", () => {
    expect(
      drinksPanelSearchLabel({ drinkCategory: "gin", requireCocktails: false }, null, 22),
    ).toBe("Show 22 Gin pubs");
  });

  it("returns singular label for count of 1", () => {
    expect(
      drinksPanelSearchLabel({ drinkCategory: "whisky", requireCocktails: false }, null, 1),
    ).toBe("Show 1 Whisky pub");
  });

  it("returns 'No … pubs found' when category active but zero matches", () => {
    expect(
      drinksPanelSearchLabel({ drinkCategory: "rum", requireCocktails: false }, null, 0),
    ).toBe("No Rum pubs found");
  });

  it("uses 'cocktail' label when requireCocktails is set without a drinkCategory", () => {
    expect(
      drinksPanelSearchLabel({ drinkCategory: "", requireCocktails: true }, null, 10),
    ).toBe("Show 10 cocktail pubs");
  });

  it("returns fallback pubs label when only favoritePint is set", () => {
    expect(
      drinksPanelSearchLabel(
        { drinkCategory: "", requireCocktails: false },
        "guinness",
        7,
      ),
    ).toBe("Show 7 pubs");
  });

  it("returns 'No matching pubs found' when favoritePint set but zero matches", () => {
    expect(
      drinksPanelSearchLabel(
        { drinkCategory: "", requireCocktails: false },
        "guinness",
        0,
      ),
    ).toBe("No matching pubs found");
  });

  it("prefers drinkCategory over requireCocktails when both set", () => {
    expect(
      drinksPanelSearchLabel({ drinkCategory: "cocktail", requireCocktails: true }, null, 5),
    ).toBe("Show 5 Cocktail pubs");
  });
});
