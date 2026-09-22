import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifySoftDrinkSubtypeId,
  filterSoftDrinkHarvestRows,
  parseMbplcSoftDrinkLines,
  softDrinkRowsFromPageText,
} from "@/scripts/lib/softDrinksMenuHarvest.mjs";

const MBPLC_FIXTURE = readFileSync(
  join(process.cwd(), "__tests__/fixtures/harvest/mbplc-soft-drinks-snippet.md"),
  "utf8",
);

describe("soft drinks menu harvest", () => {
  it("parses M&B markdown soft-drink sections with verbatim prices", () => {
    const rows = parseMbplcSoftDrinkLines(MBPLC_FIXTURE);
    expect(rows.map((r) => r.drinkLabel)).toEqual([
      "Coke Zero",
      "Diet Coke",
      "Still Water",
    ]);
    expect(rows[0].priceGbp).toBe(3.25);
  });

  it("never keeps tap water as a priced product", () => {
    const rows = parseMbplcSoftDrinkLines(MBPLC_FIXTURE);
    expect(filterSoftDrinkHarvestRows(rows).some((r) => /tap/i.test(r.drinkLabel))).toBe(false);
  });

  it("classifies Coke Zero, Diet Coke and still water subtypes", () => {
    expect(classifySoftDrinkSubtypeId("Coke Zero")).toBe("soft-drink-coke-zero");
    expect(classifySoftDrinkSubtypeId("Diet Coke")).toBe("soft-drink-diet-coke");
    expect(classifySoftDrinkSubtypeId("Still Water")).toBe("soft-drink-still-water");
  });

  it("reads inline menu text through ukPriceCrawl", () => {
    const text = [
      "Coca-Cola Zero 330ml £2.80",
      "Diet Coke 330ml £2.75",
      "Pepsi Max 330ml £2.70",
      "Still water 750ml £1.95",
      "Sparkling water 750ml £2.10",
    ].join("\n");
    const rows = softDrinkRowsFromPageText(text);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.some((r) => classifySoftDrinkSubtypeId(r.drinkLabel) === "soft-drink-coke-zero")).toBe(
      true,
    );
  });
});
