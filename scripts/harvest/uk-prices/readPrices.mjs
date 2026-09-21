// Harvest price reader: regex table when keyless, TypeSafe judgment when keyed.
//
//   TYPESAFE_API_KEY unset  → lib/harvest/ukPriceCrawl.readVenueDrinkPrices (unchanged)
//   TYPESAFE_API_KEY set    → lib/harvest/ukPriceJudgment.server.readVenueDrinkPricesJudged
//   --judged without a key  → exit 1 (see usage in run.mjs)

import { chainPintReadingFromUk } from "../../../lib/harvest/chainMenuPrices.ts";
import { extractPintPrices, pintPricesFromUkReading } from "../../../lib/harvest/tavilyPintPrices.ts";
import {
  extractVenueDrinkPrices,
  venueDrinkPricesFromUkReading,
} from "../../../lib/harvest/tavilyVenueDrinkPrices.ts";
import {
  CATEGORY_PRICE_BANDS,
  pageStatesADrinksList,
  readVenueDrinkPrices,
} from "../../../lib/harvest/ukPriceCrawl.ts";

export { CATEGORY_PRICE_BANDS };
import { readVenueDrinkPricesJudged } from "../../../lib/harvest/ukPriceJudgment.server.ts";

export function typesafeKeyConfigured() {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

export async function readVenueDrinkPricesForHarvest(html, ctx) {
  const pubName = ctx?.pubName ?? "Unknown pub";
  const pageUrl = ctx?.pageUrl ?? "";
  if (!typesafeKeyConfigured()) {
    return { reading: readVenueDrinkPrices(html), review: [] };
  }
  const judged = await readVenueDrinkPricesJudged(html, { pubName, pageUrl });
  const { review, ...reading } = judged;
  return { reading, review };
}

export async function readChainPintPricesForHarvest(html, ctx) {
  const { reading, review } = await readVenueDrinkPricesForHarvest(html, ctx);
  return { reading: chainPintReadingFromUk(reading), review };
}

export async function extractPintPricesForHarvest(markdown, ctx) {
  if (!typesafeKeyConfigured()) {
    return { prices: extractPintPrices(markdown), review: [] };
  }
  const { reading, review } = await readVenueDrinkPricesForHarvest(markdown, ctx);
  return { prices: pintPricesFromUkReading(reading, markdown), review };
}

export async function extractVenueDrinkPricesForHarvest(markdown, ctx) {
  let reading;
  let review;
  let drinks;
  if (!typesafeKeyConfigured()) {
    reading = readVenueDrinkPrices(markdown);
    drinks = extractVenueDrinkPrices(markdown);
    review = [];
  } else {
    const judged = await readVenueDrinkPricesForHarvest(markdown, ctx);
    reading = judged.reading;
    review = judged.review;
    drinks = venueDrinkPricesFromUkReading(reading, markdown);
  }
  if (!pageStatesADrinksList(reading)) {
    drinks = [];
  }
  return { drinks, reading, review };
}
