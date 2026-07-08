import { describe, expect, it } from "vitest";

import {
  brandMatchNeedles,
  brandsForCategory,
  categoryHasBrandCoverage,
  findBrand,
  haystackMatchesBrand,
  haystackMatchesCategory,
  normalizeBrandQuery,
  parseDrinkCategoryParam,
} from "@/lib/drinkBrands";
import { DRINK_CATEGORIES } from "@/lib/drinks";

describe("drinkBrands", () => {
  it("exposes a catalog entry for every DrinkCategory", () => {
    for (const category of DRINK_CATEGORIES) {
      expect(Array.isArray(brandsForCategory(category))).toBe(true);
    }
  });

  it("ships starter brands for the core spirits / wine / beer / cocktail families", () => {
    for (const category of ["vodka", "gin", "whisky", "rum", "wine", "beer", "cocktail"] as const) {
      expect(brandsForCategory(category).length).toBeGreaterThanOrEqual(4);
      expect(brandsForCategory(category).length).toBeLessThanOrEqual(10);
    }
  });

  it("keeps shot/other honestly empty (thin coverage)", () => {
    expect(brandsForCategory("shot")).toEqual([]);
    expect(brandsForCategory("other")).toEqual([]);
    expect(categoryHasBrandCoverage("shot")).toBe(false);
    expect(categoryHasBrandCoverage("gin")).toBe(true);
  });

  it("normalizes brand query ids", () => {
    expect(normalizeBrandQuery(" SipSmith ")).toBe("sipsmith");
    expect(normalizeBrandQuery("Grey Goose")).toBe("grey-goose");
    expect(normalizeBrandQuery("Hendrick's")).toBe("hendrick-s");
    expect(normalizeBrandQuery(null)).toBe("");
    expect(normalizeBrandQuery(undefined)).toBe("");
  });

  it("finds brands by id across categories", () => {
    expect(findBrand("sipsmith")).toEqual({
      category: "gin",
      brand: expect.objectContaining({ id: "sipsmith", label: "Sipsmith" }),
    });
    expect(findBrand("SIPSMITH")).toEqual({
      category: "gin",
      brand: expect.objectContaining({ id: "sipsmith" }),
    });
    expect(findBrand("not-a-brand")).toBeNull();
  });

  it("matches brand aliases in haystacks", () => {
    const hit = findBrand("hendricks");
    expect(hit).not.toBeNull();
    expect(haystackMatchesBrand("Hendrick's Gin & Tonic", hit!.brand)).toBe(true);
    expect(haystackMatchesBrand("house lager", hit!.brand)).toBe(false);
    expect(brandMatchNeedles(hit!.brand).length).toBeGreaterThan(0);
  });

  it("matches category tokens in haystacks", () => {
    expect(haystackMatchesCategory("house red wine list", "wine")).toBe(true);
    expect(haystackMatchesCategory("vodka soda", "vodka")).toBe(true);
    expect(haystackMatchesCategory("guinness pint", "vodka")).toBe(false);
  });

  it("parses drink category params defensively", () => {
    expect(parseDrinkCategoryParam("gin")).toBe("gin");
    expect(parseDrinkCategoryParam("GIN")).toBe("gin");
    expect(parseDrinkCategoryParam("low-no")).toBeNull();
    expect(parseDrinkCategoryParam("wizard")).toBeNull();
  });
});
