// Tavily enrichment's pint rows, named from the page, decided by the one reader.
//
// PURE ON PURPOSE. Keep/drop is lib/harvest/ukPriceCrawl.ts. This file keeps
// the enrichment lane's own shape: a drink name and a serving size. Judgment
// stays in the CLI layer (scripts/harvest/uk-prices/readPrices.mjs).

import { readVenueDrinkPrices, type UkPriceReading } from "./ukPriceCrawl";

export type TavilyPintPrice = {
  drinkName: string;
  priceGbp: number;
  servingSize: "pint" | "568ml";
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

/**
 * Turn a shared drinks reading into this lane's named pint rows.
 *
 * Naming still belongs here: the shared reader does not extract drink names.
 * Call this on ONE drinks line, or on a name line plus a price-only table row.
 * A whole page is too wide: the shared food-word window would let a platter
 * on line four poison a pint on line one.
 */
export function pintPricesFromUkReading(
  reading: UkPriceReading,
  markdown: string,
): TavilyPintPrice[] {
  const compact = compactLines(markdown);
  const prices: TavilyPintPrice[] = [];
  const seen = new Set<string>();
  const previous = compact.length > 1 ? compact[0] : "";
  const line = compact[compact.length - 1] ?? "";

  for (const row of reading.kept) {
    if (row.category !== "beer") continue;

    let drinkName: string;
    let servingLine: string;

    if (isPriceOnlyLine(line) && previous) {
      const priceCount = [...line.matchAll(/£\s*\d/g)].length;
      if (!namesAPint(previous) && priceCount < 2) continue;
      drinkName = previous
        .replace(/\b(?:pint|568\s*ml)\b/gi, "")
        .replace(/^[-*#|>\s]+/, "")
        .replace(/\s+/g, " ")
        .trim();
      servingLine = `${previous} ${line}`;
    } else {
      const sourceLine = compact.find((candidate) => candidate.includes(row.verbatim)) ?? line;
      if (!namesAPint(sourceLine) && !namesAPint(row.context)) continue;
      const sizeMatch = /\b(pint|568\s*ml)\b/i.exec(sourceLine);
      const priceAt = sourceLine.indexOf(row.verbatim);
      const cutoff = Math.min(
        sizeMatch?.index ?? sourceLine.length,
        priceAt < 0 ? sourceLine.length : priceAt,
      );
      drinkName = cleanDrinkName(sourceLine, cutoff);
      servingLine = sourceLine;
    }

    if (rejectNamedRow(drinkName)) continue;

    const servingSize = /\b568\s*ml\b/i.test(servingLine) ? "568ml" : "pint";
    const key = `${drinkName.toLowerCase()}|${row.priceGbp}|${servingSize}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prices.push({ drinkName, priceGbp: row.priceGbp, servingSize });
  }

  return prices;
}

/**
 * This lane's input is lines, so the shared reader is asked per line (or per
 * name-plus-price table pair). That is this caller's shape, not a second table.
 */
export function extractPintPrices(markdown: string): TavilyPintPrice[] {
  const compact = compactLines(markdown);
  const prices: TavilyPintPrice[] = [];
  const seen = new Set<string>();

  for (const [index, line] of compact.entries()) {
    if (!/£/.test(line)) continue;
    const previous = index > 0 ? compact[index - 1] : "";
    const snippet = isPriceOnlyLine(line) && previous ? `${previous}\n${line}` : line;
    for (const row of pintPricesFromUkReading(readVenueDrinkPrices(snippet), snippet)) {
      const key = `${row.drinkName.toLowerCase()}|${row.priceGbp}|${row.servingSize}`;
      if (seen.has(key)) continue;
      seen.add(key);
      prices.push(row);
    }
  }

  return prices;
}
