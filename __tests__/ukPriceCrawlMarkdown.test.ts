import { describe, expect, it } from "vitest";
import { findUkPriceCandidates, readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

// Exact price lines from The Eagle's permission-checked PDF read on 13 October 2026.
const eagleMarkdown = `Fig Negroni................................ **_£13.5_**
Plymouth Gin, Campari, Fig Liqueur

Negroni 0.0 AF.................... **_£10.5_**
Tanqueray 0.0%, Lyre’s Italian Spritz
0.0%, Three Spirit Livener 0.0%
*(46 kcal)*`;

describe("published menu markdown", () => {
  it.each([
    ["Madri pint £6.50.", "beer", 6.5],
    ["House red wine 175ml £7.50.", "wine", 7.5],
  ])("accepts a terminal full stop in %s", (menu, category, priceGbp) => {
    expect(readVenueDrinkPrices(menu).kept).toEqual([
      expect.objectContaining({ category, priceGbp }),
    ]);
    expect(readVenueDrinkPrices(menu.replace(/\.$/, "0")).kept).toEqual([]);
    expect(readVenueDrinkPrices(menu.replace(/\.$/, ".1")).kept).toEqual([]);
  });

  it("retains every stated decimal without taking a whole-pound prefix", () => {
    expect(findUkPriceCandidates(eagleMarkdown).map(({ verbatim, priceGbp }) => ({ verbatim, priceGbp })))
      .toEqual([
        { verbatim: "£13.5", priceGbp: 13.5 },
        { verbatim: "£10.5", priceGbp: 10.5 },
      ]);
    expect(findUkPriceCandidates("Coke **_£5.35_**").map((row) => row.priceGbp)).toEqual([5.35]);
    expect(findUkPriceCandidates("Coke £5.350")).toEqual([]);
  });

  it("keeps the priced cocktail title instead of the markdown price wrapper", () => {
    expect(readVenueDrinkPrices(eagleMarkdown).kept.map(({ drinkLabel, category, priceGbp }) => (
      { drinkLabel, category, priceGbp }
    ))).toEqual([
      { drinkLabel: "Fig Negroni", category: "cocktail", priceGbp: 13.5 },
    ]);
    expect(readVenueDrinkPrices(eagleMarkdown).drops).toContain("outside-category-band");
    expect(readVenueDrinkPrices("Negroni 0.0 AF **_£7.5_**").kept).toEqual([
      expect.objectContaining({ drinkLabel: "Negroni 0.0 AF", category: "alcohol-free", priceGbp: 7.5 }),
    ]);
  });

  it("rejects a detached wrapped price instead of pricing the preceding ingredients", () => {
    const reading = readVenueDrinkPrices(`Cranberry & Mint...........................................
Cranberry, Moroccan & English Mint, Fever-Tree
Ginger Ale *(93kcal)*

**_£5.35_**`);
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toContain("item-name-ambiguous");
  });

  it("does not assign a named markdown drink its ingredient's category", () => {
    const reading = readVenueDrinkPrices(`Yuzu Honeybee................... **_£13.5_**
Jameson Irish Whiskey, Beesou
Honey Aperitif, Yuzu Sherbet,
Fever-Tree Ginger Ale`);
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toContain("no-category-word-nearby");
  });
});
