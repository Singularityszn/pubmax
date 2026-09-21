// Harvest price reader: regex table when keyless, TypeSafe judgment when keyed.
//
//   TYPESAFE_API_KEY unset  → lib/harvest/ukPriceCrawl.readVenueDrinkPrices (unchanged)
//   TYPESAFE_API_KEY set    → lib/harvest/ukPriceJudgment.server.readVenueDrinkPricesJudged
//   --judged without a key  → exit 1 (see usage in run.mjs)

import { chainPintReadingFromUk } from "../../../lib/harvest/chainMenuPrices.ts";
import { extractPintPrices, pintPricesFromUkReading } from "../../../lib/harvest/tavilyPintPrices.ts";
import { readVenueDrinkPrices } from "../../../lib/harvest/ukPriceCrawl.ts";
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
