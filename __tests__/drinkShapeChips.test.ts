import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  nextDrinkShapeFilters,
  nextDrinkSubtypeFilters,
  nextTopShelfFilters,
  showsDrinkRefinements,
} from "@/components/map/DrinkShapeChips";
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
    wetherspoonsOnly: false,
    requireStepFree: false,
    requireAccessibleToilet: false,
    requireSeatedService: false,
    drinkCategory: "",
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    zone: "",
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

  it("drops a stale subtype when the category changes or is switched off", () => {
    expect(
      nextDrinkShapeFilters(
        filters({ drinkCategory: "rum", drinkSubtype: "rum-dark" }),
        "whisky",
      ),
    ).toMatchObject({ drinkCategory: "whisky", drinkSubtype: "" });

    expect(
      nextDrinkShapeFilters(
        filters({
          drinkCategory: "rum",
          drinkSubtype: "rum-dark",
          topShelfOnly: true,
        }),
        "rum",
      ),
    ).toMatchObject({
      drinkCategory: "",
      drinkSubtype: "",
      topShelfOnly: false,
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
});

describe("nextDrinkSubtypeFilters", () => {
  it("sets the subtype ALONGSIDE its parent category, never replacing it", () => {
    expect(nextDrinkSubtypeFilters(filters(), "rum-dark")).toMatchObject({
      drinkCategory: "rum",
      drinkSubtype: "rum-dark",
    });
    expect(
      nextDrinkSubtypeFilters(filters({ drinkCategory: "whisky" }), "whisky-japanese"),
    ).toMatchObject({ drinkCategory: "whisky", drinkSubtype: "whisky-japanese" });
  });

  it("toggles the active subtype off while keeping the category lens", () => {
    expect(
      nextDrinkSubtypeFilters(
        filters({ drinkCategory: "rum", drinkSubtype: "rum-dark" }),
        "rum-dark",
      ),
    ).toMatchObject({ drinkCategory: "rum", drinkSubtype: "" });
  });

  it("keeps the cocktail amenity in sync and ignores unknown ids", () => {
    expect(nextDrinkSubtypeFilters(filters(), "cocktail-spritz")).toMatchObject({
      drinkCategory: "cocktail",
      requireCocktails: true,
      drinkSubtype: "cocktail-spritz",
    });
    const before = filters({ drinkCategory: "rum" });
    expect(nextDrinkSubtypeFilters(before, "rum-unicorn")).toBe(before);
  });
});

describe("nextTopShelfFilters", () => {
  it("toggles without disturbing the active drink lens", () => {
    const lens = filters({ drinkCategory: "rum", drinkSubtype: "rum-dark" });
    const on = nextTopShelfFilters(lens);
    expect(on).toMatchObject({
      topShelfOnly: true,
      drinkCategory: "rum",
      drinkSubtype: "rum-dark",
    });
    expect(nextTopShelfFilters(on).topShelfOnly).toBe(false);
  });

  it("does not create a hidden top-shelf filter without a category", () => {
    const before = filters();
    expect(nextTopShelfFilters(before)).toBe(before);
    expect(
      nextTopShelfFilters(filters({ drinkCategory: "vodka" })).topShelfOnly,
    ).toBe(true);
  });

  it("pins the category when the row was disclosed by the cocktails amenity alone", () => {
    const on = nextTopShelfFilters(filters({ requireCocktails: true }));
    expect(on).toMatchObject({
      drinkCategory: "cocktail",
      requireCocktails: true,
      topShelfOnly: true,
    });
    // Unchecking the ControlRail cocktails box afterwards leaves the pinned
    // category, so the refinement row (and the toggle) stays reachable.
    const unchecked = { ...on, requireCocktails: false };
    expect(unchecked.drinkCategory).toBe("cocktail");
    expect(nextTopShelfFilters(unchecked).topShelfOnly).toBe(false);
  });
});

describe("selected drink price lens controls", () => {
  it("does not offer brandless subtype claims for non-pint price lenses", () => {
    expect(showsDrinkRefinements(filters({ drinkCategory: "whisky" }))).toBe(false);
    expect(showsDrinkRefinements(filters({ drinkCategory: "beer" }))).toBe(true);
  });
});

// The mobile filter sheet renders DrinkShapeChips without MapToolbar (a
// desktop-only dynamic chunk), so the chip styles only reach a 390px viewport
// if the component imports its stylesheet itself. Locked from source, the same
// idiom as mapBannerStagingCss.test.ts.
describe("drink chip styling ships with the component", () => {
  const component = readFileSync(
    join(process.cwd(), "components/map/DrinkShapeChips.tsx"),
    "utf8",
  );
  const css = readFileSync(
    join(process.cwd(), "components/map/mapToolbar.css"),
    "utf8",
  );

  it("imports the chip stylesheet directly (not only via MapToolbar)", () => {
    expect(component).toMatch(/import\s+"\.\/mapToolbar\.css"/);
  });

  it("keeps selected-state rules for subtype and top-shelf chips in that stylesheet", () => {
    expect(css).toMatch(/\.drinkShapeChip\.isOn/);
    expect(css).toMatch(/\.drinkSubtypeChip\.isOn/);
    expect(css).toMatch(/\.drinkSubtypeChip\.isTopShelf\.isOn/);
  });
});
