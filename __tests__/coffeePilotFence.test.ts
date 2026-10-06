// Coffee pilot fence (PR 1): tea, water and affogato never become coffee prices;
// matcha is a coffee word; flat white, latte and matcha latte do not collapse.
// The misfiled rows fixture is frozen from the bundle the fence was written against.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/typesafe.server.ts", () => ({
  systemOneOutcome: vi.fn(),
}));

import { systemOneOutcome } from "@/lib/ai/typesafe.server";
import { coffeePriceLabelExcluded } from "@/lib/coffeePricePilot";
import { drinkCategoryFromText } from "@/lib/drinkCategoryFromText";
import { cheapestPerCategory, readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import { readVenueDrinkPricesJudged } from "@/lib/harvest/ukPriceJudgment.server";

const MISFILED_ROWS = join(process.cwd(), "__tests__/fixtures/harvest/coffee-pilot-misfiled-rows.json");

function coffeeRowsBesideAmericano(label: string, priceGbp: number) {
  const html = `<p>Americano £3.00</p><p>${label} £${priceGbp.toFixed(2)}</p>`;
  return readVenueDrinkPrices(html)
    .kept.filter((row) => row.category === "coffee" && row.drinkLabel !== "Americano")
    .map(({ drinkLabel, priceGbp: price }) => ({ drinkLabel, priceGbp: price }));
}

describe("coffee pilot harvest fence", () => {
  it("names matcha as coffee in free-text taxonomy", () => {
    expect(drinkCategoryFromText("Matcha")).toBe("coffee");
    expect(drinkCategoryFromText("Iced matcha")).toBe("coffee");
  });

  it.each([
    ["Highland Spring Water Sparkling", 1.5],
    ["Bottled Water", 2],
    ["Water", 1.5],
    ["Mineral Water", 1.5],
    ["Coconut water", 2.5],
    ["Earl Grey Tea", 2.5],
    ["Tea", 2],
    ["Earl Grey", 2.8],
    ["English Breakfast", 2.6],
    ["Chai", 2.9],
    ["Peppermint", 2.4],
    ["Herbal infusion", 2.4],
    ["Green", 2.4],
    ["Chai latte", 3.6],
    ["Turmeric latte", 3.6],
    ["Earl Grey latte", 3.6],
    ["Affogato (vg) Vanilla ice cream, shot of hot espresso", 6],
  ])("refuses %s as a coffee price beside an espresso drink", (label, priceGbp) => {
    expect(coffeeRowsBesideAmericano(label, priceGbp)).toEqual([]);
    expect(coffeePriceLabelExcluded(label)).toBe(true);
  });

  it.each([
    "Matcha",
    "Matcha latte",
    "Matcha green tea latte",
    "Dirty chai with espresso",
    "Americano, espresso and hot water",
    "Iced latte",
  ])(
    "keeps %s as a coffee price",
    (label) => {
      expect(coffeePriceLabelExcluded(label)).toBe(false);
    },
  );

  it("files a tea latte as not-coffee and a matcha latte as coffee", () => {
    const rows = readVenueDrinkPrices(
      "<p>Chai latte £3.60</p><p>Turmeric latte £3.70</p><p>Matcha latte £4.00</p>",
    ).kept;
    expect(
      rows.filter((row) => row.category === "coffee").map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp })),
    ).toEqual([{ drinkLabel: "Matcha latte", priceGbp: 4 }]);
  });

  it("does not widen the reader's coffee words beyond matcha", () => {
    const rows = readVenueDrinkPrices("<p>Macchiato £3.20</p><p>Cortado £3.40</p>").kept;
    expect(rows.filter((row) => row.category === "coffee")).toEqual([]);
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
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ drinkLabel: "Flat white", priceGbp: 3.5 }),
        expect.objectContaining({ drinkLabel: "Latte", priceGbp: 3.8 }),
        expect.objectContaining({ drinkLabel: "Matcha latte", priceGbp: 4 }),
      ]),
    );
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

describe("coffee pilot misfiled rows fixture", () => {
  it("refuses every tea, water and affogato label the bundle once filed as coffee", () => {
    const rows = JSON.parse(readFileSync(MISFILED_ROWS, "utf8")) as Array<{
      drinkLabel: string;
      priceGbp: number;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(coffeePriceLabelExcluded(row.drinkLabel)).toBe(true);
      expect(coffeeRowsBesideAmericano(row.drinkLabel, row.priceGbp)).toEqual([]);
    }
  });
});

describe("coffee pilot fence on the TypeSafe-judged reader", () => {
  function judgeEveryFigureAsCoffee(questions: Record<string, unknown>) {
    const count = Object.keys(questions).filter((key) => key.startsWith("whatIsPriced_")).length;
    const answers: Record<string, unknown> = {};
    for (let index = 0; index < count; index += 1) {
      answers[`whatIsPriced_${index}`] = {
        type: "choice",
        choice: "soft_drink_or_coffee",
        probabilities: { soft_drink_or_coffee: 0.95 },
      };
      answers[`isPromotionalPrice_${index}`] = { type: "noul", noul: 0.01 };
      answers[`drinkCategory_${index}`] = {
        type: "choice",
        choice: "coffee",
        probabilities: { coffee: 0.95 },
      };
    }
    return {
      status: "ok" as const,
      result: { model: "jev-test", usage: { input_tokens: 1, output_tokens: 1 }, answers },
    } as Awaited<ReturnType<typeof systemOneOutcome>>;
  }

  it("refuses tea, water and affogato the judge calls coffee and keeps the pilot drinks", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(systemOneOutcome).mockImplementation(async (_state, questions) =>
      judgeEveryFigureAsCoffee(questions),
    );
    try {
      const judged = await readVenueDrinkPricesJudged(
        `<p>Earl Grey Tea £2.50</p>
        <p>Bottled Water £2.00</p>
        <p>Affogato £6.00</p>
        <p>Flat white £3.50</p>
        <p>Latte £3.80</p>
        <p>Matcha latte £4.00</p>`,
        { pubName: "Shoreditch Grind", pageUrl: "https://shoreditchgrind.example/menu" },
      );
      expect(
        judged.kept.map(({ category, drinkLabel, priceGbp }) => ({ category, drinkLabel, priceGbp })),
      ).toEqual([
        { category: "coffee", drinkLabel: "Flat white", priceGbp: 3.5 },
        { category: "coffee", drinkLabel: "Latte", priceGbp: 3.8 },
        { category: "coffee", drinkLabel: "Matcha latte", priceGbp: 4 },
      ]);
    } finally {
      vi.unstubAllEnvs();
      vi.mocked(systemOneOutcome).mockReset();
    }
  });
});
