import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractVenueDrinkPrices,
  venueDrinkPricesFromUkReading,
} from "@/lib/harvest/tavilyVenueDrinkPrices";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import {
  pubDiscoveryAvailable,
  verbatimValidateHarvestedDrinks,
} from "../scripts/harvest_outer_london_prices.mjs";

describe("outer London full-category drink extraction", () => {
  it.each([
    "Each Beer Token gets you your first pint £5.80",
    "Enjoy quality beer for just £4.00 a pint",
    "Royal National drop into The London Pub. Grab a TLP lager (at just £5.45 a pint)",
    "[![Image 16: Craft Beer Wednesdays £6.00 a pint](https://example.com/event)",
    "Cocktails cost you between £7.00 and £12.00 in London.",
  ])("does not invent menu labels from promotional prose: %s", (text) => {
    expect(extractVenueDrinkPrices(text)).toEqual([]);
  });
  it("names beer, wine and cocktail rows from a drinks list snippet", () => {
    const markdown = `
Madri pint £6.20
House red wine 175ml £7.50
Espresso martini £12.00
`;
    const drinks = extractVenueDrinkPrices(markdown);
    expect(drinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "beer", drinkName: "Madri", priceGbp: 6.2 }),
        expect.objectContaining({ category: "wine", priceGbp: 7.5 }),
        expect.objectContaining({ category: "cocktail", drinkName: "Espresso martini", priceGbp: 12 }),
      ]),
    );
  });

  it("maps a shared reading through venueDrinkPricesFromUkReading", () => {
    const markdown = "Tanqueray gin & tonic £5.50";
    const reading = readVenueDrinkPrices(`<p>${markdown}</p>`);
    expect(venueDrinkPricesFromUkReading(reading, markdown)).toEqual([
      expect.objectContaining({ category: "gin", drinkName: "Tanqueray gin & tonic", priceGbp: 5.5 }),
    ]);
  });

  it("verbatimValidateHarvestedDrinks drops figures not on the page", () => {
    const pagePounds = new Set(["6.20"]);
    const validated = verbatimValidateHarvestedDrinks(
      [
        { drinkName: "Madri", category: "beer", priceGbp: 6.2 },
        { drinkName: "Ghost", category: "wine", priceGbp: 8.5 },
      ],
      pagePounds,
    );
    expect(validated).toEqual([
      { drinkName: "Madri", category: "beer", priceGbp: 6.2 },
    ]);
  });

  it("pubDiscoveryAvailable is false without EXA_API_KEY", () => {
    expect(pubDiscoveryAvailable({ TAVILY_API_KEY: "tavily" })).toBe(false);
    expect(pubDiscoveryAvailable({ EXA_API_KEY: "exa", TAVILY_API_KEY: "tavily" })).toBe(true);
  });

  it("outer London harvest script calls the shared venue drink reader", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts/harvest_outer_london_prices.mjs"),
      "utf8",
    );
    expect(source).toMatch(/extractVenueDrinkPricesMaybeJudged/);
    expect(source).not.toMatch(/extractPintPricesMaybeJudged/);
  });
});
