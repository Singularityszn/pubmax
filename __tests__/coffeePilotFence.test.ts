// Coffee pilot fence (PR 1): tea, water and affogato never become coffee prices;
// matcha is a coffee word; flat white, latte and matcha latte do not collapse.
// The 73 legacy `category: coffee` bundle rows stay committed as evidence.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COFFEE_PILOT_NAMED_DRINKS,
  canonicalCoffeePilotDrink,
  coffeePriceLabelExcluded,
} from "@/lib/coffeePricePilot";
import { drinkCategoryFromText } from "@/lib/drinkCategoryFromText";
import { cheapestPerCategory, readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

const BUNDLE_ROWS = join(process.cwd(), "public/data/uk_prices/rows.json");

describe("coffee pilot harvest fence", () => {
  it("names matcha as coffee in free-text taxonomy", () => {
    expect(drinkCategoryFromText("Matcha")).toBe("coffee");
    expect(drinkCategoryFromText("Iced matcha")).toBe("coffee");
  });

  it.each([
    ["Highland Spring Water Sparkling", 1.5],
    ["Bottled Water", 2],
    ["Earl Grey Tea", 2.5],
    ["Tea", 2],
    ["Affogato (vg) Vanilla ice cream, shot of hot espresso", 6],
  ])("refuses %s as a coffee price", (label, priceGbp) => {
    const html = `<p>${label} £${priceGbp.toFixed(2)}</p>`;
    const reading = readVenueDrinkPrices(html);
    expect(reading.kept.filter((row) => row.category === "coffee")).toEqual([]);
    expect(coffeePriceLabelExcluded(label)).toBe(true);
  });

  it("refuses tea even when the next line names coffee", () => {
    const html = `
      <p>Tea £2.00</p>
      <p>Coffee Espresso £2.50</p>
      <p>Flat white £3.50</p>
      <p>Latte £3.80</p>`;
    const rows = cheapestPerCategory(readVenueDrinkPrices(html)).filter(
      (row) => row.category === "coffee",
    );
    expect(rows.map((row) => row.drinkLabel)).not.toContain("Tea");
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ drinkLabel: "Flat white", priceGbp: 3.5 }),
        expect.objectContaining({ drinkLabel: "Latte", priceGbp: 3.8 }),
        expect.objectContaining({ drinkLabel: "Coffee Espresso", priceGbp: 2.5 }),
      ]),
    );
  });

  it("keeps flat white, latte and matcha latte as three figures", () => {
    const html = `
      <p>Flat white £3.50</p>
      <p>Latte £3.80</p>
      <p>Matcha latte £4.00</p>
      <p>Filter coffee £3.00</p>`;
    const rows = cheapestPerCategory(readVenueDrinkPrices(html)).filter(
      (row) => row.category === "coffee",
    );
    const pilotKeys = rows.map((row) => canonicalCoffeePilotDrink(row.drinkLabel));
    expect(pilotKeys.filter(Boolean).sort()).toEqual([...COFFEE_PILOT_NAMED_DRINKS].sort());
    expect(rows).toHaveLength(4);
  });

  it("does not collapse two pilot drinks that share a line but state two prices", () => {
    const html = "<p>Flat white Latte £3.50 £3.80</p>";
    const rows = cheapestPerCategory(readVenueDrinkPrices(html)).filter(
      (row) => row.category === "coffee",
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const prices = rows.map((row) => row.priceGbp).sort();
    expect(prices).toEqual([3.5, 3.8]);
  });
});

describe("coffee pilot bundle regression fixture", () => {
  it("keeps 73 legacy coffee rows as misread evidence", () => {
    const rows = JSON.parse(readFileSync(BUNDLE_ROWS, "utf8")) as Array<{
      category: string;
      drinkLabel?: string;
    }>;
    const coffee = rows.filter((row) => row.category === "coffee");
    expect(coffee).toHaveLength(73);
  });

  it("flags every tea, water and affogato label the bundle already misfiled", () => {
    const rows = JSON.parse(readFileSync(BUNDLE_ROWS, "utf8")) as Array<{
      category: string;
      drinkLabel?: string;
      priceGbp: number;
    }>;
    const mislabeled = rows.filter(
      (row) =>
        row.category === "coffee" &&
        typeof row.drinkLabel === "string" &&
        coffeePriceLabelExcluded(row.drinkLabel),
    );
    expect(mislabeled.length).toBeGreaterThanOrEqual(8);
    for (const row of mislabeled) {
      const html = `<p>${row.drinkLabel} £${row.priceGbp.toFixed(2)}</p>`;
      expect(
        readVenueDrinkPrices(html).kept.some((kept) => kept.category === "coffee"),
      ).toBe(false);
    }
  });
});
