import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../scripts/lib/localRefreshProviders.mjs", async (importOriginal) => ({
  ...await importOriginal<typeof import("../scripts/lib/localRefreshProviders.mjs")>(),
  fetchRefreshPage: vi.fn(),
}));

import {
  extractVenueDrinkPrices,
  venueDrinkPricesFromUkReading,
} from "@/lib/harvest/tavilyVenueDrinkPrices";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import {
  pubDiscoveryAvailable,
  scrape,
  verbatimValidateHarvestedDrinks,
} from "../scripts/harvest_outer_london_prices.mjs";
import { fetchRefreshPage } from "../scripts/lib/localRefreshProviders.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("outer London full-category drink extraction", () => {
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
    expect(venueDrinkPricesFromUkReading(reading)).toEqual([
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

  it("returns the menu's wine and cocktail beside its pints from the harvest script", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const url = "https://thecrown.example/drinks-menu";
    vi.mocked(fetchRefreshPage).mockResolvedValue({
      finalUrl: url,
      links: [],
      markdown: [
        "Guinness pint £6.20",
        "Madri pint £6.40",
        "Peroni pint £6.60",
        "Camden lager pint £6.80",
        "House red wine 175ml £7.50",
        "Espresso martini £12.00",
      ].join("\n"),
    });
    const page = await scrape(url, "The Crown", url, async () => ({ allowed: true }));
    expect(page.json.drinks).toEqual([
      { drinkName: "Guinness", category: "beer", priceGbp: 6.2 },
      { drinkName: "Madri", category: "beer", priceGbp: 6.4 },
      { drinkName: "Peroni", category: "beer", priceGbp: 6.6 },
      { drinkName: "Camden lager", category: "beer", priceGbp: 6.8 },
      { drinkName: "House red wine 175ml", category: "wine", priceGbp: 7.5 },
      { drinkName: "Espresso martini", category: "cocktail", priceGbp: 12 },
    ]);
  });
});
