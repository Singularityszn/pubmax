// Tavily enrichment's pint rows, named from the page, decided by the one reader.
//
// PURE ON PURPOSE. Keep/drop is lib/harvest/ukPriceCrawl.ts. This file keeps
// the enrichment lane's own shape: a drink name and a serving size. Judgment
// stays in the CLI layer (scripts/harvest/uk-prices/readPrices.mjs).

import { pricedMenuSnippets, readVenueDrinkPrices, type UkPriceReading } from "./ukPriceCrawl";

export type TavilyPintPrice = {
  drinkName: string;
  priceGbp: number;
  servingSize: "pint" | "568ml";
};

function cleanDrinkName(line: string, cutoff: number): string {
  return line
    .slice(0, cutoff)
    .replace(/^[-*#|>\s]+/, "")
    .replace(/\b(?:draught|draft)\b\s*[:|-]?\s*/gi, "")
    .replace(/^(?:(?:beer|boards|cider|drinks|flight|menu)\s+){2,}/i, "")
    .replace(/\s+\d{1,2}(?:\.\d+)?%(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s:|()[\]\u2013\u2014-]+$/, "")
    .trim();
}

function namesAPint(text: string): boolean {
  return /\b(?:pint|draught|draft|568\s*ml)\b/i.test(text);
}

function rejectNamedRow(drinkName: string): boolean {
  if (drinkName.length < 2 || drinkName.length > 100) return true;
  if (/[£]|\bhalf\b/i.test(drinkName)) return true;
  return (
    /["“”]/.test(drinkName) ||
    /\b(?:all beers?|beer is priced|lunchtime)\b/i.test(drinkName) ||
    /\b(?:at|for|from|only)\s*$/i.test(drinkName)
  );
}

export function pintPricesFromUkReading(
  reading: UkPriceReading,
): TavilyPintPrice[] {
  const prices: TavilyPintPrice[] = [];
  const seen = new Set<string>();

  for (const row of reading.kept) {
    if (row.category !== "beer") continue;

    const item = row.item;
    if (!item || (!namesAPint(item.text) && !item.pintColumn)) continue;
    const sizeMatch = /\b(pint|568\s*ml)\b/i.exec(item.label);
    const drinkName = cleanDrinkName(item.label, sizeMatch?.index ?? item.label.length);

    if (rejectNamedRow(drinkName)) continue;

    const servingSize = /\b568\s*ml\b/i.test(item.text) ? "568ml" : "pint";
    const key = `${drinkName.toLowerCase()}|${row.priceGbp}|${servingSize}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prices.push({ drinkName, priceGbp: row.priceGbp, servingSize });
  }

  return prices;
}

export function extractPintPrices(markdown: string): TavilyPintPrice[] {
  const prices: TavilyPintPrice[] = [];
  const seen = new Set<string>();

  for (const snippet of pricedMenuSnippets(markdown)) {
    for (const row of pintPricesFromUkReading(readVenueDrinkPrices(snippet))) {
      const key = `${row.drinkName.toLowerCase()}|${row.priceGbp}|${row.servingSize}`;
      if (seen.has(key)) continue;
      seen.add(key);
      prices.push(row);
    }
  }

  return prices;
}
