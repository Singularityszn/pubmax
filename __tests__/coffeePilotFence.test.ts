// Coffee pilot fence (PR 1): tea, water and affogato never become coffee prices;
// matcha is a coffee word; flat white, latte and matcha latte do not collapse.
// The 85 legacy `category: coffee` bundle rows stay committed as evidence.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/typesafe.server.ts", () => ({
  systemOneOutcome: vi.fn(),
}));

import { systemOneOutcome } from "@/lib/ai/typesafe.server";

import {
  COFFEE_PILOT_NAMED_DRINKS,
  canonicalCoffeePilotDrink,
  coffeePriceLabelExcluded,
} from "@/lib/coffeePricePilot";
import { drinkCategoryFromText } from "@/lib/drinkCategoryFromText";
import { cheapestPerCategory, readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import { readVenueDrinkPricesJudged } from "@/lib/harvest/ukPriceJudgment.server";

const BUNDLE_ROWS = join(process.cwd(), "public/data/uk_prices/rows.json");
const ESPRESSO_GBP = 2.65;

describe("coffee pilot harvest fence", () => {
  it("names matcha as coffee in free-text taxonomy", () => {
    expect(drinkCategoryFromText("Matcha")).toBe("coffee");
    expect(drinkCategoryFromText("Iced matcha")).toBe("coffee");
  });

  it.each([
    ["Highland Spring Water Sparkling", 1.5],
    ["Bottled Water", 2],
    ["Water", 1.5],
    ["Tap water", 1],
    ["Mineral water", 1.8],
    ["Earl Grey Tea", 2.5],
    ["Tea", 2],
    ["Hot water", 1],
    ["Chai latte", 3.2],
    ["Chai tea latte", 3.8],
    ["Earl grey tea latte", 3.8],
    ["Affogato (vg) Vanilla ice cream, shot of hot espresso", 6],
  ])("refuses %s as a coffee price beside an espresso line", (label, priceGbp) => {
    const html = `<p>${label} £${priceGbp.toFixed(2)}</p><p>Espresso £${ESPRESSO_GBP.toFixed(2)}</p>`;
    const coffee = readVenueDrinkPrices(html).kept.filter((row) => row.category === "coffee");
    expect(coffee.map((row) => row.priceGbp)).toEqual([ESPRESSO_GBP]);
    expect(coffeePriceLabelExcluded(label)).toBe(true);
  });

  it("keeps a coffee drink whose description names water", () => {
    expect(coffeePriceLabelExcluded("Americano (espresso and hot water)")).toBe(false);
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

  it("keys only an exact pilot drink, cheapest wins, and never folds in another drink", () => {
    const html = `
      <p>Flat white £3.50</p>
      <p>flat white £3.70</p>
      <p>Latte £3.80</p>
      <p>Latte macchiato £3.40</p>
      <p>Latte (oat) £4.10</p>
      <p>Iced latte £3.20</p>
      <p>Matcha latte £4.00</p>`;
    const rows = cheapestPerCategory(readVenueDrinkPrices(html)).filter(
      (row) => row.category === "coffee",
    );
    const byPilot = new Map(
      rows
        .filter((row) => canonicalCoffeePilotDrink(row.drinkLabel))
        .map((row) => [canonicalCoffeePilotDrink(row.drinkLabel), row.priceGbp]),
    );
    expect(Object.fromEntries(byPilot)).toEqual({
      "flat white": 3.5,
      latte: 3.8,
      "matcha latte": 4,
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ drinkLabel: "Latte macchiato", priceGbp: 3.4 }),
        expect.objectContaining({ drinkLabel: "Latte (oat)", priceGbp: 4.1 }),
        expect.objectContaining({ drinkLabel: "Iced latte", priceGbp: 3.2 }),
      ]),
    );
    expect(rows).toHaveLength(6);
  });

  it.each([
    "<h3>Affogato</h3><p>Vanilla ice cream, shot of hot espresso £6.00</p>",
    "<h3>Earl Grey Tea</h3><p>Pot for one £2.50</p>",
    "<h4>Affogato</h4><p>Vanilla gelato</p><p>Shot of hot espresso £5.00</p>",
    "<h4>Affogato (v)</h4><p>Vanilla gelato</p><p>Shot of hot espresso £5.00</p>",
    "<h3>Coffee</h3><p>Hot water £1.00</p>",
    "<h3>Affogato</h3><p>Espresso over vanilla gelato £5.00</p>",
    "<h3>Affogato</h3><p>Shot of espresso, vanilla ice cream £5.00</p>",
    "<h3>Affogato</h3><p>Double espresso poured over ice cream £5.50</p>",
    "<h2>Coffee</h2><h3>Peppermint tea</h3><p>Infused in hot water £2.20</p>",
    "<h2>Hot drinks: coffee &amp; tea</h2><h3>Fresh mint tea</h3><p>Steeped in hot water £2.50</p>",
    "<h3>Earl Grey tea</h3><p>Latte £3.50</p>",
    "<h3>Chai</h3><p>Latte £3.50</p>",
    "<h3>Earl Grey tea</h3><p>Also served as a latte £3.20</p>",
  ])("refuses the item a name heading calls tea or affogato: %s", (item) => {
    const html = `${item}<p>Espresso £${ESPRESSO_GBP.toFixed(2)}</p>`;
    const coffee = readVenueDrinkPrices(html).kept.filter((row) => row.category === "coffee");
    expect(coffee.map((row) => row.priceGbp)).toEqual([ESPRESSO_GBP]);
  });

  it.each([
    "<p>Espresso £2.65</p><p>Ask about our affogato</p><p>Flat white £3.50</p><p>Latte £3.80</p>",
    "<p>Espresso £2.65</p><p>Any coffee can be served as an affogato</p><p>Flat white £3.50</p><p>Latte £3.80</p>",
    "<h3>Coffee &amp; Affogato</h3><p>Espresso £2.65</p><p>Flat white £3.50</p><p>Latte £3.80</p>",
    "<p>Espresso £2.65</p><p>Affogato available on request</p><p>Flat white £3.50</p><p>Latte £3.80</p>",
    "<p>Espresso £2.65</p><p>Affogato options</p><p>Flat white £3.50</p><p>Latte £3.80</p>",
  ])("keeps pilot drinks after an affogato note on another line: %s", (html) => {
    const coffee = readVenueDrinkPrices(html).kept.filter((row) => row.category === "coffee");
    expect(coffee.map((row) => row.priceGbp)).toEqual([2.65, 3.5, 3.8]);
  });

  it.each([
    [
      "<p>Espresso £2.65</p><p>Affogato</p><p>Ask for today's flavour</p><p>Cappuccino £3.20</p><p>Americano £3.00</p>",
      [2.65, 3.2, 3],
    ],
    ["<p>Espresso £2.65</p><p>Affogato:</p><p>Cappuccino £3.20</p>", [2.65, 3.2]],
  ])("keeps a named coffee under an affogato name: %s", (html, prices) => {
    const coffee = readVenueDrinkPrices(html).kept.filter((row) => row.category === "coffee");
    expect(coffee.map((row) => row.priceGbp)).toEqual(prices);
  });

  it("judges tea and water on the priced line, not a joined heading", () => {
    const html = `
      <h2>Tea &amp; Coffee</h2>
      <p>Tea £2.00</p>
      <p>Coffee £2.50</p>
      <p>Filter coffee, brewed with filtered water £3.00</p>`;
    const coffee = readVenueDrinkPrices(html).kept.filter((row) => row.category === "coffee");
    expect(coffee.map((row) => row.priceGbp)).toEqual([2.5, 3]);
  });

  it.each([
    ["<h2>Tea &amp; Coffee</h2><p>Coffee £2.50</p>", 2.5],
    ["<p>Filter coffee, brewed with filtered water £3.00</p>", 3],
    ["<h3>Filter coffee</h3><p>Brewed with filtered water £3.00</p>", 3],
    ["<h3>Cold brew coffee</h3><p>Steeped in cold water for 18 hours £3.80</p>", 3.8],
    ["<p>Matcha latte £4.00</p>", 4],
    ["<p>Americano (espresso and hot water) £3.00</p>", 3],
  ])("keeps the coffee in %s", (html, priceGbp) => {
    const coffee = readVenueDrinkPrices(html).kept.filter((row) => row.category === "coffee");
    expect(coffee.map((row) => row.priceGbp)).toEqual([priceGbp]);
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

describe("coffee pilot judged harvest fence", () => {
  function everyCandidateJudgedCoffee(questionMap: Record<string, unknown>) {
    const count = Object.keys(questionMap).filter((key) => key.startsWith("whatIsPriced_")).length;
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

  it("refuses tea, water and affogato the model files as coffee", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.mocked(systemOneOutcome).mockImplementation(async (_state, questions) =>
      everyCandidateJudgedCoffee(questions),
    );
    try {
      const judged = await readVenueDrinkPricesJudged(
        `<p>Earl Grey Tea £2.50</p>
        <p>Water £1.50</p>
        <p>Affogato (vg) Vanilla ice cream, shot of hot espresso £6.00</p>
        <p>Flat white £3.50</p>`,
        { pubName: "Shoreditch Cafe", pageUrl: "https://example.co.uk/menu" },
      );
      const coffee = judged.kept.filter((row) => row.category === "coffee");
      expect(coffee).toEqual([
        expect.objectContaining({ drinkLabel: "Flat white", priceGbp: 3.5 }),
      ]);
      for (const note of ["Ask about our affogato", "Affogato available on request"]) {
        const noted = await readVenueDrinkPricesJudged(
          `<p>Espresso £2.65</p><p>${note}</p><p>Flat white £3.50</p>`,
          { pubName: "Shoreditch Cafe", pageUrl: "https://example.co.uk/menu" },
        );
        expect(
          noted.kept.filter((row) => row.category === "coffee").map((row) => row.priceGbp),
        ).toEqual([2.65, 3.5]);
      }
      for (const item of [
        "<p>Tea - £2.00</p>",
        "<p>Water | £1.50</p>",
        "<h3>Affogato</h3><p>Vanilla ice cream, shot of hot espresso £6.00</p>",
        "<h3>Earl Grey Tea</h3><p>Pot for one £2.50</p>",
        "<h4>Affogato</h4><p>Vanilla gelato</p><p>Shot of hot espresso £5.00</p>",
        "<h3>Affogato</h3><p>Espresso over vanilla gelato £5.00</p>",
        "<h3>Affogato</h3><p>Shot of espresso, vanilla ice cream £5.00</p>",
        "<h2>Coffee</h2><h3>Peppermint tea</h3><p>Infused in hot water £2.20</p>",
        "<h3>Chai</h3><p>Latte £3.50</p>",
      ]) {
        const page = await readVenueDrinkPricesJudged(
          `${item}<p>Espresso - £${ESPRESSO_GBP.toFixed(2)}</p>`,
          { pubName: "Shoreditch Cafe", pageUrl: "https://example.co.uk/menu" },
        );
        expect(
          page.kept.filter((row) => row.category === "coffee").map((row) => row.priceGbp),
        ).toEqual([ESPRESSO_GBP]);
      }
    } finally {
      vi.unstubAllEnvs();
      vi.mocked(systemOneOutcome).mockReset();
    }
  });
});

describe("coffee pilot bundle regression fixture", () => {
  it("keeps 85 coffee evidence rows from the recorded 23 October cohort", () => {
    const rows = JSON.parse(readFileSync(BUNDLE_ROWS, "utf8")) as Array<{
      category: string;
      sourceUrl: string | null;
      observedAt: string;
    }>;
    const reconciliation = JSON.parse(readFileSync(
      join(process.cwd(), "data/uk_prices/site_harvest_reconciliation.json"), "utf8",
    )) as { laterPublications: Array<{ sourceUrl: string; sourceObservedAt: string }> };
    // The recorded Small Beer publication closes this historical cohort.
    // Later publications may add coffee without changing its evidence count.
    const laterSources = new Set(reconciliation.laterPublications
      .filter((publication) => publication.sourceObservedAt > "2026-10-23T16:15:47.970Z")
      .map((publication) => `${publication.sourceUrl}|${publication.sourceObservedAt}`));
    const coffee = rows.filter((row) => row.category === "coffee" &&
      !laterSources.has(`${row.sourceUrl}|${row.observedAt}`));
    expect(coffee).toHaveLength(85);
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
      const html = `<p>${row.drinkLabel} £${row.priceGbp.toFixed(2)}</p><p>Espresso £${ESPRESSO_GBP.toFixed(2)}</p>`;
      const coffee = readVenueDrinkPrices(html).kept.filter((kept) => kept.category === "coffee");
      expect(coffee.map((kept) => kept.priceGbp)).toEqual([ESPRESSO_GBP]);
    }
  });
});
