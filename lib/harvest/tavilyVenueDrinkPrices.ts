// Named drink rows for every category the shared reader keeps.
//
// PURE ON PURPOSE. Category and verbatim gates live in lib/harvest/ukPriceCrawl.ts.
// Judgment stays in scripts/harvest/uk-prices/readPrices.mjs.

import type { DrinkCategory } from "@/lib/drinks";

import {
  pintPricesFromUkReading,
  type TavilyPintPrice,
} from "./tavilyPintPrices";
import { readVenueDrinkPrices, type UkPriceReading } from "./ukPriceCrawl";

export type TavilyVenueDrinkPrice = {
  drinkName: string;
  priceGbp: number;
  category: DrinkCategory;
};

function unescapePounds(markdown: string): string {
  return String(markdown ?? "").replace(/\\£/g, "£");
}

function compactLines(markdown: string): string[] {
  return unescapePounds(markdown)
    .split(/\r?\n/)
    .map((line) => line.replace(/^[_*]+|[_*]+$/g, "").trim())
    .filter(Boolean);
}

function isPriceOnlyLine(line: string): boolean {
  return /^(?:£\s*\d{1,2}(?:\.\d{1,2})?\s*(?:[|/]\s*)?)+$/.test(line);
}

function cleanNamedDrink(line: string, cutoff: number): string {
  return line
    .slice(0, cutoff)
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

function nameNonBeerRow(row: UkPriceReading["kept"][number], markdown: string): string | null {
  const compact = compactLines(markdown);
  const sourceLine =
    compact.find((candidate) => candidate.includes(row.verbatim)) ?? row.context;
  const priceAt = sourceLine.indexOf(row.verbatim);
  const drinkName = cleanNamedDrink(sourceLine, priceAt < 0 ? sourceLine.length : priceAt);
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

/**
 * Turn a shared drinks reading into named rows for every kept category.
 *
 * Beer naming reuses the pint lane's rules; spirits, wine and cocktails are
 * named from the line that carried the verbatim figure.
 */
export function venueDrinkPricesFromUkReading(
  reading: UkPriceReading,
  markdown: string,
): TavilyVenueDrinkPrice[] {
  const prices: TavilyVenueDrinkPrice[] = [];
  const seen = new Set<string>();

  for (const pint of pintPricesFromUkReading(reading, markdown)) {
    const row = pintToVenueRow(pint);
    const key = `${row.drinkName.toLowerCase()}|${row.category}|${row.priceGbp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prices.push(row);
  }

  for (const row of reading.kept) {
    if (row.category === "beer") continue;
    const drinkName = nameNonBeerRow(row, markdown);
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
  const compact = compactLines(markdown);
  const prices: TavilyVenueDrinkPrice[] = [];
  const seen = new Set<string>();

  for (const [index, line] of compact.entries()) {
    if (!/£/.test(line)) continue;
    const previous = index > 0 ? compact[index - 1] : "";
    const snippet = isPriceOnlyLine(line) && previous ? `${previous}\n${line}` : line;
    mergeVenueDrinkRows(prices, seen, venueDrinkPricesFromUkReading(read(snippet), snippet));
  }

  return prices;
}

export function extractVenueDrinkPrices(markdown: string): TavilyVenueDrinkPrice[] {
  return extractVenueDrinkPricesWithReader(markdown, readVenueDrinkPrices);
}
