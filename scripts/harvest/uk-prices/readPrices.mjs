// Harvest price reader: regex table when keyless, TypeSafe judgment when keyed.
//
//   TYPESAFE_API_KEY unset  → lib/harvest/ukPriceCrawl.readVenueDrinkPrices (unchanged)
//   TYPESAFE_API_KEY set    → lib/harvest/ukPriceJudgment.server.readVenueDrinkPricesJudged
//   --judged without a key  → exit 1 (see usage in run.mjs)

import { chainPintReadingFromUk } from "../../../lib/harvest/chainMenuPrices.ts";
import { extractPintPrices, pintPricesFromUkReading } from "../../../lib/harvest/tavilyPintPrices.ts";
import {
  extractVenueDrinkPrices,
  extractVenueDrinkPricesWithReader,
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

async function extractVenueDrinkPricesJudgedLinewise(markdown, ctx) {
  const review = [];
  const unescape = (text) => String(text ?? "").replace(/\\£/g, "£");
  const compact = unescape(markdown)
    .split(/\r?\n/)
    .map((line) => line.replace(/^[_*]+|[_*]+$/g, "").trim())
    .filter(Boolean);
  const drinks = [];
  const seen = new Set();

  for (let index = 0; index < compact.length; index += 1) {
    const line = compact[index];
    if (!/£/.test(line)) continue;
    const previous = index > 0 ? compact[index - 1] : "";
    const priceOnly = /^(?:£\s*\d{1,2}(?:\.\d{1,2})?\s*(?:[|/]\s*)?)+$/.test(line);
    const snippet = priceOnly && previous ? `${previous}\n${line}` : line;
    const judged = await readVenueDrinkPricesForHarvest(snippet, ctx);
    review.push(...judged.review);
    for (const row of venueDrinkPricesFromUkReading(judged.reading, snippet)) {
      const key = `${row.drinkName.toLowerCase()}|${row.category}|${row.priceGbp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      drinks.push(row);
    }
  }

  return { drinks, review };
}

export async function extractVenueDrinkPricesForHarvest(markdown, ctx) {
  const reading = readVenueDrinkPrices(markdown);
  let review;
  let drinks;
  if (!typesafeKeyConfigured()) {
    drinks = extractVenueDrinkPricesWithReader(markdown, readVenueDrinkPrices);
    review = [];
  } else {
    const judged = await extractVenueDrinkPricesJudgedLinewise(markdown, ctx);
    drinks = judged.drinks;
    review = judged.review;
  }
  if (!pageStatesADrinksList(reading)) {
    drinks = [];
  }
  return { drinks, reading, review };
}
