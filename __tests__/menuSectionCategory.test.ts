import { describe, expect, it } from "vitest";

import {
  mapGreeneKingSectionToCategory,
  mapMbplcSectionToCategory,
} from "@/scripts/lib/menuSectionCategory.mjs";

describe("first-party menu section categories", () => {
  it.each([
    ["Main Menu Drinks", null],
    ["Dessert Wine", null],
    ["Sparkling Wine", "wine"],
    ["0% Beer", "cocktail"],
    ["Stout & Keg", "beer"],
    ["Whiskey", "whisky"],
    ["Hot Drinks", "coffee"],
    ["No & Low", "alcohol-free"],
    ["Drinks", "soft-drink"],
    ["Burgers", null],
  ])("maps Greene King %s to %s", (heading, category) => {
    expect(mapGreeneKingSectionToCategory(heading)).toBe(category);
  });

  it.each([
    ["Fever-Tree Tonic", null],
    ["Breakfast Beer", null],
    ["Sparkling Wine", "wine"],
    ["Hot Drinks", "coffee"],
    ["Low And No Beer", "alcohol-free"],
    ["Soda", "soft-drink"],
    ["Craft Beer", "beer"],
    ["Tequila", "shot"],
    ["Other Drinks", "other"],
    ["Burgers", null],
  ])("maps Nicholson's %s to %s", (heading, category) => {
    expect(mapMbplcSectionToCategory(heading)).toBe(category);
  });
});
