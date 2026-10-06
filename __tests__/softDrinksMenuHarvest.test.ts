import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { SoftDrinkHarvestRow } from "../scripts/lib/softDrinksMenuHarvest.mjs";
import {
  classifySoftDrinkSubtypeId,
  filterSoftDrinkHarvestRows,
  parseMbplcSoftDrinkLines,
  softDrinkRowsFromMenuPdfLinks,
  softDrinkRowsFromPageText,
} from "../scripts/lib/softDrinksMenuHarvest.mjs";
import { defined } from "@/__tests__/helpers/defined";

const MBPLC_FIXTURE = readFileSync(
  join(process.cwd(), "__tests__/fixtures/harvest/mbplc-soft-drinks-snippet.md"),
  "utf8",
);

describe("soft drinks menu harvest", () => {
  it("parses M&B markdown soft-drink sections with verbatim prices", () => {
    const rows = parseMbplcSoftDrinkLines(MBPLC_FIXTURE);
    expect(rows.map((r: SoftDrinkHarvestRow) => r.drinkLabel)).toEqual([
      "Coke Zero",
      "Diet Coke",
      "Still Water",
    ]);
    expect(defined(rows[0]).priceGbp).toBe(3.25);
  });

  it("never keeps tap water as a priced product", () => {
    const rows = parseMbplcSoftDrinkLines(MBPLC_FIXTURE);
    expect(filterSoftDrinkHarvestRows(rows).some((r: SoftDrinkHarvestRow) => /tap/i.test(r.drinkLabel))).toBe(false);
  });

  it("fails closed on alcohol, cocktails, headings, and malformed labels", () => {
    const rows: SoftDrinkHarvestRow[] = [
      { category: "soft-drink", priceGbp: 2.8, drinkLabel: "Coke Zero" },
      { category: "soft-drink", priceGbp: 6, drinkLabel: "6% Belgium Augustiner Helles" },
      {
        category: "soft-drink",
        priceGbp: 5.95,
        drinkLabel: "Long Island Iced Tea vodka, gin, tequila, rum, coke",
      },
      { category: "soft-drink", priceGbp: 7, drinkLabel: "Mimosa orange juice" },
      { category: "soft-drink", priceGbp: 3, drinkLabel: "Non-alcoholic ginger beer" },
      { category: "soft-drink", priceGbp: 4.5, drinkLabel: "Elderflower Fizz" },
      { category: "soft-drink", priceGbp: 6.5, drinkLabel: "Soda & Sparkling Marg" },
      { category: "soft-drink", priceGbp: 4.2, drinkLabel: "Ginger beer mocktail" },
      { category: "soft-drink", priceGbp: 12, drinkLabel: "Sunday Roasts" },
      { category: "soft-drink", priceGbp: 2, drinkLabel: ".2 ORANGE, APPLE, CRANBERRY ½ PINT FRANKLINS" },
    ];

    expect(filterSoftDrinkHarvestRows(rows).map((row) => row.drinkLabel)).toEqual([
      "Coke Zero",
      "Non-alcoholic ginger beer",
    ]);
  });

  it("does not fetch a PDF from a different publisher or origin", async () => {
    const fetchImpl = vi.fn();
    const rows = await softDrinkRowsFromMenuPdfLinks(
      "[Drinks menu](https://evil.example/menus/drinks.pdf)",
      {
        pageUrl: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
        sourceId: "greene-king-menu-prices",
        fetchImpl,
      },
    );
    expect(rows).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("selects the stated drinks-list PDF, not wine or cocktail PDFs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
    );
    const events: { status: string }[] = [];
    const pageUrl = "https://www.theeaglew12.co.uk/food-drink";
    const rows = await softDrinkRowsFromMenuPdfLinks(
      [
        "[Wine List](https://www.theeaglew12.co.uk/wine.pdf)",
        "[Summer Spritz](https://www.theeaglew12.co.uk/spritz.pdf)",
        "[Drinks List](https://www.theeaglew12.co.uk/Drinks-Menus.pdf)",
      ].join(" "),
      {
        pageUrl,
        sourceId: "youngs-menu-prices",
        associatedHosts: ["theeaglew12.co.uk"],
        fetchImpl,
        robotsChecker: async () => ({ allowed: true, reason: "allowed", evidence: "fixture" }),
        onPdfEvent: (event: { status: string }) => events.push(event),
      },
    );
    expect(rows).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://www.theeaglew12.co.uk/Drinks-Menus.pdf");
    expect(events.map((event) => event.status)).toEqual(["unreadable-pdf"]);
  });

  it("classifies Coke Zero, Diet Coke and still water subtypes", () => {
    expect(classifySoftDrinkSubtypeId("330ml Kingsdown Still/Sparkling Water")).toBe(
      "soft-drink-still-water",
    );
    expect(classifySoftDrinkSubtypeId("Coke Zero")).toBe("soft-drink-coke-zero");
    expect(classifySoftDrinkSubtypeId("Diet Coke")).toBe("soft-drink-diet-coke");
    expect(classifySoftDrinkSubtypeId("Pepsi Max")).toBe("soft-drink-pepsi-max");
    expect(classifySoftDrinkSubtypeId("Diet Pepsi")).toBe("soft-drink-diet-pepsi");
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
    expect(rows.some((r: SoftDrinkHarvestRow) => classifySoftDrinkSubtypeId(r.drinkLabel) === "soft-drink-coke-zero")).toBe(
      true,
    );
  });
});
