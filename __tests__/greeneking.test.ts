import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  candidateDrinksFromMarkdown,
  candidateFoodFromText,
  identityFromMenuUrl,
  mapSectionToCategory,
  mapSectionToFoodCategory,
  matchVenue,
  parseDrinkMarkdown,
  parseFoodMarkdownFromInteractText,
  slugFromGreeneKingUrl,
  type DatasetVenue,
} from "@/lib/greeneking";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("slug / identity", () => {
  it("extracts locality + slug from a menu URL", () => {
    expect(
      slugFromGreeneKingUrl(
        "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
      ),
    ).toEqual({ locality: "greater-london", slug: "prospect-of-whitby" });
  });

  it("builds identity from a menu URL", () => {
    const id = identityFromMenuUrl(
      "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
      "Prospect of Whitby",
    );
    expect(id).toMatchObject({
      name: "Prospect of Whitby",
      slug: "prospect-of-whitby",
      locality: "greater-london",
    });
  });
});

describe("mapSectionToCategory", () => {
  it("maps Greene King drink sections", () => {
    expect(mapSectionToCategory("White Wine (10)")).toBe("wine");
    expect(mapSectionToCategory("Cocktails (9)")).toBe("cocktail");
    expect(mapSectionToCategory("Spritz Cocktails (5)")).toBe("cocktail");
    expect(mapSectionToCategory("0% Cocktails (6)")).toBe("other");
    expect(mapSectionToCategory("Draught beer")).toBe("beer");
  });

  it("returns null for food sections", () => {
    expect(mapSectionToCategory("Burgers")).toBeNull();
    expect(mapSectionToCategory("Starters")).toBeNull();
  });
});

describe("mapSectionToFoodCategory", () => {
  it("maps food sections", () => {
    expect(mapSectionToFoodCategory("Starters")).toBe("starters");
    expect(mapSectionToFoodCategory("Sharers")).toBe("sharers");
    expect(mapSectionToFoodCategory("Mains (Classics)")).toBe("mains");
    expect(mapSectionToFoodCategory("Burgers")).toBe("burgers");
    expect(mapSectionToFoodCategory("Desserts")).toBe("desserts");
    expect(mapSectionToFoodCategory("Sides")).toBe("sides");
    expect(mapSectionToFoodCategory("Bar Snacks")).toBe("bar-snacks");
  });
});

describe("parseDrinkMarkdown (Prospect wine fixture)", () => {
  const md = readFixture("greene-king-prospect-drinks.md");

  it("parses glass + bottle wine and cocktail prices", () => {
    const items = parseDrinkMarkdown(md);
    const pinotGlass = items.find(
      (i) => i.name.startsWith("Organic Pinot Grigio") && i.servingSize === "glass",
    );
    const pinotBottle = items.find(
      (i) => i.name.startsWith("Organic Pinot Grigio") && i.servingSize === "bottle",
    );
    expect(pinotGlass?.priceGbp).toBe(7.2);
    expect(pinotGlass?.abv).toBe(11.5);
    expect(pinotBottle?.priceGbp).toBe(30);

    const margarita = items.find((i) => i.name === "Margarita");
    expect(margarita?.priceGbp).toBe(10.5);
    expect(mapSectionToCategory(margarita!.section)).toBe("cocktail");

    const zero = items.find((i) => i.name === "0% Mojito");
    expect(zero?.priceGbp).toBe(9);
    expect(mapSectionToCategory(zero!.section)).toBe("other");
  });

  it("emits candidate rows with identity", () => {
    const identity = identityFromMenuUrl(
      "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
      "Prospect of Whitby",
    )!;
    const rows = candidateDrinksFromMarkdown(md, identity);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((r) => r.identity.slug === "prospect-of-whitby")).toBe(true);
    expect(rows.some((r) => r.category === "wine")).toBe(true);
    expect(rows.some((r) => r.category === "cocktail")).toBe(true);
  });
});

describe("parseFoodMarkdownFromInteractText", () => {
  const text = readFixture("greene-king-prospect-food.txt");

  it("parses starter/main/burger bullets with prices", () => {
    const items = parseFoodMarkdownFromInteractText(text);
    expect(items.find((i) => i.name === "Soup of the Day")?.priceGbp).toBe(6.45);
    expect(items.find((i) => i.name === "Fish & Chips")?.priceGbp).toBe(19.95);
    expect(items.find((i) => i.name === "Classic Burger")?.priceGbp).toBe(15.45);
    expect(mapSectionToFoodCategory(items.find((i) => i.name === "Soup of the Day")!.section)).toBe(
      "starters",
    );
  });

  it("builds food candidates", () => {
    const identity = identityFromMenuUrl(
      "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
      "Prospect of Whitby",
    )!;
    const rows = candidateFoodFromText(text, identity);
    expect(rows.some((r) => r.category === "mains" && r.itemName === "Fish & Chips")).toBe(true);
    expect(rows.every((r) => r.priceGbp > 0)).toBe(true);
  });
});

describe("matchVenue", () => {
  const dataset: DatasetVenue[] = [
    {
      venueKey: "prospect of whitby|57 wapping wall, e1w 3sh|51.50710|-0.05113",
      name: "Prospect of Whitby",
      address: "57 Wapping Wall, E1W 3SH",
      website: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby",
    },
    {
      venueKey: "other arms|1 other st|51.50000|-0.10000",
      name: "Other Arms",
      address: "1 Other St",
      website: "https://example.com",
    },
  ];

  it("matches by website slug", () => {
    const identity = identityFromMenuUrl(
      "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
      "Prospect of Whitby",
    )!;
    const hit = matchVenue(identity, dataset);
    expect(hit?.venueKey).toBe(dataset[0].venueKey);
    expect(hit?.score).toBe(1);
  });

  it("returns null when unmatched", () => {
    const identity = identityFromMenuUrl(
      "https://www.greeneking.co.uk/pubs/greater-london/golden-fleece/menu",
      "Golden Fleece",
    )!;
    expect(matchVenue(identity, dataset)).toBeNull();
  });
});
