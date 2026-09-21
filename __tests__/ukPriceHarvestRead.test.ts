import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { readChainPintPrices } from "@/lib/harvest/chainMenuPrices";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import { extractPintPrices } from "@/scripts/lib/tavilyPubEnrichment.mjs";

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

    try {
      const { readVenueDrinkPricesForHarvest } = await import(
        "../scripts/harvest/uk-prices/readPrices.mjs"
      );
      const { reading, review } = await readVenueDrinkPricesForHarvest(drinksList, {
        pubName: "The Crown",
        pageUrl: "https://thecrown.co.uk/drinks",
      });

      expect(review).toEqual([]);
      expect(reading).toEqual(readVenueDrinkPrices(drinksList));
    } finally {
      // Restore on the failing path too: a leaked unset key would silently put
      // every later test in this worker on the keyless path.
      if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous;
    }
  });
});

describe("chain and Tavily harvest readers without TYPESAFE_API_KEY", () => {
  it("maps the shared reading onto the chain shape", async () => {
    const previous = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;

    try {
      const { readChainPintPricesForHarvest } = await import(
        "../scripts/harvest/uk-prices/readPrices.mjs"
      );
      const html = `<html><body><li>Camden Hells Lager, pint &pound;6.20</li></body></html>`;
      const { reading, review } = await readChainPintPricesForHarvest(html, {
        pubName: "The Crown",
        pageUrl: "https://thecrown.co.uk/drinks",
      });

      expect(review).toEqual([]);
      expect(reading).toEqual(readChainPintPrices(html));
      expect(reading.kept).toEqual([expect.objectContaining({ priceGbp: 6.2, verbatim: "£6.20" })]);
    } finally {
      if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous;
    }
  });

  it("maps the shared reading onto Tavily pint rows", async () => {
    const previous = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;

    try {
      const { extractPintPricesForHarvest } = await import(
        "../scripts/harvest/uk-prices/readPrices.mjs"
      );
      const markdown = "Manchester Pale Ale - Pint £5.40";
      const { prices, review } = await extractPintPricesForHarvest(markdown, {
        pubName: "The Crown",
        pageUrl: "https://thecrown.co.uk/drinks",
      });

      expect(review).toEqual([]);
      expect(prices).toEqual(extractPintPrices(markdown));
    } finally {
      if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous;
    }
  });

  it("chain and Tavily CLIs call the harvest reader, not a second extractor", () => {
    const chain = readFileSync(
      join(process.cwd(), "scripts/harvest_chain_menu_prices.mjs"),
      "utf8",
    );
    const tavily = readFileSync(
      join(process.cwd(), "scripts/lib/tavilyPubEnrichment.mjs"),
      "utf8",
    );
    expect(chain).toMatch(/readChainPintPricesForHarvest|readChainPintPricesMaybeJudged/);
    expect(tavily).toMatch(/extractPintPricesForHarvest|extractPintPricesMaybeJudged/);
    expect(tavily).not.toMatch(/function extractPintPrices\s*\(/);
  });
});
