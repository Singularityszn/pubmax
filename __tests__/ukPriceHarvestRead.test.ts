import { describe, expect, it, vi } from "vitest";

import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

vi.mock("@/lib/harvest/ukPriceJudgment.server.ts", () => ({
  readVenueDrinkPricesJudged: vi.fn(),
}));

const drinksList = `
<html><body>
  <p>Madri pint &pound;6.20</p>
  <p>Guinness pint &pound;6.40</p>
  <p>Neck Oil pint &pound;6.80</p>
  <p>House red wine 175ml &pound;7.50</p>
</body></html>`;

describe("harvest price reader without TYPESAFE_API_KEY", () => {
  it("uses the regex table unchanged when no key is configured", async () => {
    const previous = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;

    const { readVenueDrinkPricesForHarvest } = await import(
      "../scripts/harvest/uk-prices/readPrices.mjs"
    );
    const { reading, review } = await readVenueDrinkPricesForHarvest(drinksList, {
      pubName: "The Crown",
      pageUrl: "https://thecrown.co.uk/drinks",
    });

    expect(review).toEqual([]);
    expect(reading).toEqual(readVenueDrinkPrices(drinksList));

    if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous;
  });
});
