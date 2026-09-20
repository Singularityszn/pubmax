// Harvest price reader: regex table when keyless, TypeSafe judgment when keyed.
//
//   TYPESAFE_API_KEY unset  → lib/harvest/ukPriceCrawl.readVenueDrinkPrices (unchanged)
//   TYPESAFE_API_KEY set    → lib/harvest/ukPriceJudgment.server.readVenueDrinkPricesJudged
//   --judged without a key  → exit 1 (see usage in run.mjs)

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
