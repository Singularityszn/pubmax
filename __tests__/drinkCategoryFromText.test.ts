import { describe, expect, it } from "vitest";

import { drinkCategoryFromText } from "@/lib/drinkCategoryFromText";

describe("drinkCategoryFromText", () => {
  it("returns null for empty / unknown / non-string input", () => {
    expect(drinkCategoryFromText("")).toBeNull();
    expect(drinkCategoryFromText("   ")).toBeNull();
    expect(drinkCategoryFromText("a memory")).toBeNull();
    expect(drinkCategoryFromText("the usual")).toBeNull();
    expect(drinkCategoryFromText(null)).toBeNull();
    expect(drinkCategoryFromText(undefined)).toBeNull();
  });

  it("classifies beer/pint labels", () => {
    expect(drinkCategoryFromText("Guinness")).toBe("beer");
    expect(drinkCategoryFromText("A cheeky pint")).toBe("beer");
    expect(drinkCategoryFromText("Neck Oil IPA")).toBe("beer");
    expect(drinkCategoryFromText("House lager")).toBe("beer");
    expect(drinkCategoryFromText("Rekorderlig cider")).toBe("beer");
  });

  it("classifies wine including bare 'red'/'white'", () => {
    expect(drinkCategoryFromText("House red")).toBe("wine");
    expect(drinkCategoryFromText("Large white wine")).toBe("wine");
    expect(drinkCategoryFromText("Malbec")).toBe("wine");
    expect(drinkCategoryFromText("Prosecco")).toBe("wine");
  });

  it("classifies spirits and cocktails", () => {
    expect(drinkCategoryFromText("Single malt whisky")).toBe("whisky");
    expect(drinkCategoryFromText("Bourbon, neat")).toBe("whisky");
    expect(drinkCategoryFromText("Gin and tonic")).toBe("gin");
    expect(drinkCategoryFromText("Negroni")).toBe("gin");
    expect(drinkCategoryFromText("Vodka soda")).toBe("vodka");
    expect(drinkCategoryFromText("Dark rum")).toBe("rum");
    expect(drinkCategoryFromText("Mojito")).toBe("rum");
    expect(drinkCategoryFromText("Aperol spritz")).toBe("cocktail");
    expect(drinkCategoryFromText("Tequila shot")).toBe("shot");
  });

  it("does not let a substring over-match (word boundaries)", () => {
    // "red" must not match inside another word.
    expect(drinkCategoryFromText("Shredded nachos")).toBeNull();
    // "ale" must not match inside "kale".
    expect(drinkCategoryFromText("Kale smoothie")).toBeNull();
  });

  it("prefers the more specific family over the broad beer net", () => {
    // "ginger beer" contains "beer" but reads as a real ginger beer → beer is
    // acceptable here; the guard we care about is wine/spirits winning first.
    expect(drinkCategoryFromText("Red wine")).toBe("wine");
    expect(drinkCategoryFromText("Whisky sour")).toBe("whisky");
  });
});
