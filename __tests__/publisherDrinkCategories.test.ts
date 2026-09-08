import { describe, expect, it } from "vitest";
import {
  mapGreeneKingSectionToCategory as greeneKing,
  mapMbplcSectionToCategory as mbplc,
} from "../scripts/lib/publisherDrinkCategories.mjs";

describe("publisher menu heading policies", () => {
  it.each([
    ["Wines and Champagne", "wine", "wine"],
    ["Sparkling cocktails", "wine", "wine"],
    ["Cocktails and gin", "cocktail", "cocktail"],
    ["Spritz", "cocktail", "cocktail"],
    ["Draught lager and cider", "beer", "beer"],
    ["Cask ales", "beer", "beer"],
    ["Whiskey and rum", "whisky", "whisky"],
    ["Gin and vodka", "gin", "gin"],
    ["Vodka and rum", "vodka", "vodka"],
    ["Rum spirits", "rum", "rum"],
    ["Spirits and shots", "shot", "shot"],
    ["Coffee and hot drinks", "coffee", "coffee"],
    ["Soft drinks", "soft-drink", "soft-drink"],
    ["Alcohol-free beer", "beer", "alcohol-free"],
    ["Alcohol free gin", "gin", "alcohol-free"],
    ["Non-alcoholic cocktails", "cocktail", "cocktail"],
    ["No & low", "alcohol-free", "alcohol-free"],
    ["No and low", "alcohol-free", "alcohol-free"],
    ["Low and no", null, "alcohol-free"],
    ["0% drinks", "cocktail", null],
    ["0.0 beer", "beer", "alcohol-free"],
    ["0.0", null, "alcohol-free"],
    ["Drinks", "soft-drink", null],
    ["Other", null, "other"],
    ["Other drinks", "soft-drink", "other"],
    ["Craft", null, "beer"],
    ["Keg", "beer", null],
    ["Stout", "beer", null],
    ["Soda", null, "soft-drink"],
    ["Tequila", null, "shot"],
    ["Beer and coffee", "beer", "coffee"],
    ["Soda and beer", "beer", "soft-drink"],
    ["Hot drinks and gin", "gin", "coffee"],
    ["Champagne alcohol-free", "wine", "wine"],
    // Preserve substring matching, including matches inside longer words.
    ["Ginger drinks", "gin", "gin"],
    ["Whisky", "whisky", "whisky"],
    ["Burgers", null, null],
    ["", null, null],
    ["   ", null, null],
  ] as const)("classifies %s with each publisher's precedence", (heading, gk, mb) => {
    expect(greeneKing(heading)).toBe(gk);
    expect(mbplc(heading)).toBe(mb);
    expect(greeneKing(heading.toUpperCase())).toBe(gk);
    expect(mbplc(heading.toUpperCase())).toBe(mb);
  });

  it.each(["main menu", "dessert", "snack", "kids", "ciabatta", "sunday menu", "gluten"])(
    "Greene King excludes %s even with a drink keyword",
    heading => expect(greeneKing(`${heading}: wine and beer`)).toBeNull(),
  );

  it.each(["fever-tree", "mixer", "tonic", "main menu", "sandwich", "buffet", "breakfast", "food"])(
    "M&B excludes %s even with a drink keyword",
    heading => expect(mbplc(`${heading}: wine and beer`)).toBeNull(),
  );

  it.each([
    ["Gin and tonic", "gin", null],
    ["Fever-tree soft drinks", "soft-drink", null],
    ["Dessert wines", null, "wine"],
    ["Gluten-free beer", null, "beer"],
  ] as const)("keeps publisher-specific exclusions for %s", (heading, gk, mb) => {
    expect(greeneKing(heading)).toBe(gk);
    expect(mbplc(heading)).toBe(mb);
  });

  it("keeps invalid inputs outside the string-only parser boundary", () => {
    for (const heading of [null, undefined, 42, {}]) {
      expect(() => greeneKing(heading)).toThrow(TypeError);
      expect(() => mbplc(heading)).toThrow(TypeError);
    }
  });
});
