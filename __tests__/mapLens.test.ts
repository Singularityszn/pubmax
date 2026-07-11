import { describe, expect, it } from "vitest";

import { isMapLensActive } from "@/lib/mapLens";

const base = {
  drinkCategory: "",
  cuisineTag: "",
  requireFood: false,
  requireCocktails: false,
  requireNonAlcoholic: false,
};

describe("isMapLensActive", () => {
  it("returns false when no lens is active", () => {
    expect(isMapLensActive(base)).toBe(false);
  });

  it("returns true when drinkCategory is set", () => {
    expect(isMapLensActive({ ...base, drinkCategory: "beer" })).toBe(true);
    expect(isMapLensActive({ ...base, drinkCategory: "cocktail" })).toBe(true);
  });

  it("returns true when cuisineTag is set", () => {
    expect(isMapLensActive({ ...base, cuisineTag: "pizza" })).toBe(true);
    expect(isMapLensActive({ ...base, cuisineTag: "burger" })).toBe(true);
  });

  it("returns true when requireFood is true", () => {
    expect(isMapLensActive({ ...base, requireFood: true })).toBe(true);
  });

  it("returns true when requireCocktails is true", () => {
    expect(isMapLensActive({ ...base, requireCocktails: true })).toBe(true);
  });

  it("returns true when requireNonAlcoholic is true", () => {
    expect(isMapLensActive({ ...base, requireNonAlcoholic: true })).toBe(true);
  });

  it("returns false when drinkCategory is an empty string", () => {
    expect(isMapLensActive({ ...base, drinkCategory: "" })).toBe(false);
  });

  it("returns false when cuisineTag is an empty string", () => {
    expect(isMapLensActive({ ...base, cuisineTag: "" })).toBe(false);
  });
});
