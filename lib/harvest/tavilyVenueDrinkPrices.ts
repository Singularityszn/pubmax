// Named drink rows for every category the shared reader keeps.
//
// PURE ON PURPOSE. Category and verbatim gates live in lib/harvest/ukPriceCrawl.ts.
// Judgment stays in scripts/harvest/uk-prices/readPrices.mjs.

import type { DrinkCategory } from "@/lib/drinks";

import {
  pintPricesFromUkReading,
  type TavilyPintPrice,
} from "./tavilyPintPrices";
import { pricedMenuSnippets, readVenueDrinkPrices, type UkPriceReading } from "./ukPriceCrawl";

export type TavilyVenueDrinkPrice = {
  drinkName: string;
  priceGbp: number;
  category: DrinkCategory;
};

function cleanNamedDrink(line: string): string {
  return line
    .replace(/^[-*#|>\s]+/, "")
    .replace(/\s+\d{1,2}(?:\.\d+)?%(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s:|()[\]\u2013\u2014-]+$/, "")
    .trim();
}

function rejectNamedDrink(drinkName: string): boolean {
  if (drinkName.length < 2 || drinkName.length > 100) return true;
  if (/[£]|\bhalf\b/i.test(drinkName)) return true;
  return (
    /["“”]/.test(drinkName) ||
    /\b(?:all beers?|beer is priced|lunchtime)\b/i.test(drinkName) ||
    /\b(?:at|for|from|only)\s*$/i.test(drinkName)
  );
}

function nameNonBeerRow(row: UkPriceReading["kept"][number]): string | null {
  if (!row.item) return null;
  const drinkName = cleanNamedDrink(row.item.label);
  if (rejectNamedDrink(drinkName)) return null;
  return drinkName;
}

function pintToVenueRow(pint: TavilyPintPrice): TavilyVenueDrinkPrice {
  return {
    drinkName: pint.drinkName,
    priceGbp: pint.priceGbp,
    category: "beer",
  };
}

export function venueDrinkPricesFromUkReading(
  reading: UkPriceReading,
): TavilyVenueDrinkPrice[] {
  const prices: TavilyVenueDrinkPrice[] = [];
  const seen = new Set<string>();

  for (const pint of pintPricesFromUkReading(reading)) {
    const row = pintToVenueRow(pint);
    const key = `${row.drinkName.toLowerCase()}|${row.category}|${row.priceGbp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prices.push(row);
  }

  for (const row of reading.kept) {
    if (row.category === "beer") continue;
    const drinkName = nameNonBeerRow(row);
    if (!drinkName) continue;
    const key = `${drinkName.toLowerCase()}|${row.category}|${row.priceGbp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prices.push({ drinkName, priceGbp: row.priceGbp, category: row.category });
  }

  return prices;
}

function mergeVenueDrinkRows(
  prices: TavilyVenueDrinkPrice[],
  seen: Set<string>,
  incoming: TavilyVenueDrinkPrice[],
): void {
  for (const row of incoming) {
    const key = `${row.drinkName.toLowerCase()}|${row.category}|${row.priceGbp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prices.push(row);
  }
}

/** Line-at-a-time reader input, matching the Tavily pint harvest shape. */
export function extractVenueDrinkPricesWithReader(
  markdown: string,
  read: (snippet: string) => UkPriceReading,
): TavilyVenueDrinkPrice[] {
  const prices: TavilyVenueDrinkPrice[] = [];
  const seen = new Set<string>();

  for (const snippet of pricedMenuSnippets(markdown)) {
    mergeVenueDrinkRows(prices, seen, venueDrinkPricesFromUkReading(read(snippet)));
  }

  return prices;
}

export function extractVenueDrinkPrices(markdown: string): TavilyVenueDrinkPrice[] {
  return extractVenueDrinkPricesWithReader(markdown, readVenueDrinkPrices);
}
