import { describe, expect, it } from "vitest";

import {
  drinksPanelSearchLabel,
  filterStripText,
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

// ── filterStripText ──────────────────────────────────────────────────────────

describe("filterStripText", () => {
  const noFilters = { cuisineTag: "", requireFood: false, drinkCategory: "", requireCocktails: false };

  it("returns empty string when no filters active", () => {
    expect(filterStripText("", noFilters, null, "", undefined)).toBe("");
  });

  it("shows count + cuisine tag when a cuisine tag is set", () => {
    expect(
      filterStripText("", { ...noFilters, cuisineTag: "pizza" }, null, "", 23),
    ).toBe("23 pubs · Pizza");
  });

  it("capitalises the cuisine tag", () => {
    expect(
      filterStripText("", { ...noFilters, cuisineTag: "burger" }, null, "", 5),
    ).toBe("5 pubs · Burger");
  });

  it("shows 'Food' when requireFood is set without a tag", () => {
    expect(
      filterStripText("", { ...noFilters, requireFood: true }, null, "", 18),
    ).toBe("18 pubs · Food");
  });

  it("shows drink category from filters.drinkCategory", () => {
    expect(
      filterStripText("", { ...noFilters, drinkCategory: "gin" }, null, "", 10),
    ).toBe("10 pubs · Gin");
  });

  it("shows drink category from the prop when filters.drinkCategory is empty", () => {
    expect(filterStripText("", noFilters, null, "beer", 7)).toBe("7 pubs · Beer");
  });

  it("shows 'Cocktails' when requireCocktails is set", () => {
    expect(
      filterStripText("", { ...noFilters, requireCocktails: true }, null, "", 4),
    ).toBe("4 pubs · Cocktails");
  });

  it("shows 'Your pint' when only a favourite pint is set", () => {
    expect(filterStripText("", noFilters, "guinness", "", 12)).toBe("12 pubs · Your pint");
  });

  it("shows quoted query when only a free-text search is active", () => {
    expect(filterStripText("near tube", noFilters, null, "", 33)).toBe(
      `33 pubs · "near tube"`,
    );
  });

  it("combines food tag and drink category with a comma separator", () => {
    expect(
      filterStripText(
        "",
        { ...noFilters, cuisineTag: "pizza", drinkCategory: "beer" },
        null,
        "",
        8,
      ),
    ).toBe("8 pubs · Pizza, Beer");
  });

  it("shows just labels when count is undefined", () => {
    expect(
      filterStripText("", { ...noFilters, cuisineTag: "tapas" }, null, "", undefined),
    ).toBe("Tapas");
  });

  it("shows singular 'pub' when count is 1", () => {
    expect(
      filterStripText("", { ...noFilters, cuisineTag: "steak" }, null, "", 1),
    ).toBe("1 pub · Steak");
  });
});
