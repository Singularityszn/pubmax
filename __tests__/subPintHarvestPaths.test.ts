import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/typesafe.server.ts", () => ({ systemOneOutcome: vi.fn() }));

import { systemOneOutcome } from "@/lib/ai/typesafe.server";
import { factsFromPage } from "@/lib/harvest/tavilyNightlyPass";
import { extractPintPrices, pintPricesFromUkReading } from "@/lib/harvest/tavilyPintPrices";
import { extractVenueDrinkPrices, venueDrinkPricesFromUkReading } from "@/lib/harvest/tavilyVenueDrinkPrices";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import { readVenueDrinkPricesJudged } from "@/lib/harvest/ukPriceJudgment.server";
import {
  extractPintPricesForHarvest,
  extractVenueDrinkPricesForHarvest,
  readVenueDrinkPricesForHarvest,
} from "../scripts/harvest/uk-prices/readPrices.mjs";

const fact = { sourceUrl: "https://example.test/drinks-menu/", seenOn: "2026-11-06" };
const ctx = { pubName: "The Crown", pageUrl: fact.sourceUrl };
const fullPints = [
  { drinkName: "Guinness", priceGbp: 6.2 },
  { drinkName: "Madri", priceGbp: 6.4 },
  { drinkName: "Peroni", priceGbp: 6.6 },
  { drinkName: "Camden lager", priceGbp: 6.8 },
];
const siblings = fullPints.map(({ drinkName, priceGbp }) => `<p>${drinkName} pint £${priceGbp.toFixed(2)}</p>`).join("");
const servings = [
  "1/2 pint", "1 / 2 pint", "1⁄2 pint", "½ pint", "half pint", "a half pint",
  "1/3 pint", "⅓ pint", "a third of a pint", "one-third pint", "one third pint",
  "2/3 pint", "⅔ pint", "two-thirds of a pint", "two thirds pint",
  "3/4 pint", "¾ pint", "three-quarter pint", "three-quarters pint", "¼ pint",
  "1/10 pint", "0.5 pint", "0.75 pint", "schooner",
];
const layouts: Array<[string, (serving: string) => string]> = [
  ["before the price", (serving) => `<p>Kernel stout ${serving} £6.20</p>`],
  ["after the price", (serving) => `<p>Kernel stout pint £6.20 (${serving})</p>`],
  ["in a wrapped qualifier", (serving) => `<p>Kernel stout pint £6.20<br>(${serving})</p>`],
  ["in a plain wrapped qualifier", (serving) => `Kernel stout pint £6.20\n(${serving})\n\n`],
  ["in a wrapped description", (serving) => `<p>Kernel stout draught £6.20<br>Served as ${serving}</p>`],
  ["in a preceding description", (serving) => `<p>Served as ${serving}<br>Kernel stout pint £6.20</p>`],
  ["before an equal-price sibling", (serving) => `<p>Kernel stout £6.20 (${serving}); Guinness pint £6.20</p>`],
];

function expectNamedPints(rows: Array<{ drinkName: string; priceGbp: number }>): void {
  expect(rows.map(({ drinkName, priceGbp }) => ({ drinkName, priceGbp }))).toEqual(fullPints);
}

beforeEach(() => {
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.mocked(systemOneOutcome).mockImplementation(async (_state, questions) => {
    const count = Object.keys(questions).filter((key) => key.startsWith("whatIsPriced_")).length;
    const answers: Record<string, unknown> = {};
    for (let index = 0; index < count; index += 1) {
      answers[`whatIsPriced_${index}`] = {
        type: "choice", choice: "draught_pint", probabilities: { draught_pint: 0.95 },
      };
      answers[`isPromotionalPrice_${index}`] = { type: "noul", noul: 0.01 };
      answers[`drinkCategory_${index}`] = { type: "choice", choice: "beer", probabilities: { beer: 0.95 } };
    }
    return {
      status: "ok",
      result: { model: "test", usage: { input_tokens: 1, output_tokens: 1 }, answers },
    } as Awaited<ReturnType<typeof systemOneOutcome>>;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(systemOneOutcome).mockReset();
});

describe.each(layouts)("the required serving exclusions %s", (_layout, item) => {
  it.each(servings)("publishes only the four full pints beside %s through every path", async (serving) => {
    const following = _layout === "before an equal-price sibling"
      ? fullPints.slice(1).map(({ drinkName, priceGbp }) => `<p>${drinkName} pint £${priceGbp.toFixed(2)}</p>`).join("")
      : siblings;
    const menu = item(serving) + following;
    const reading = readVenueDrinkPrices(menu);
    expect(reading.kept.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp }))).toEqual(
      fullPints.map(({ drinkName, priceGbp }) => ({ drinkLabel: `${drinkName} pint`, priceGbp })),
    );
    expectNamedPints(pintPricesFromUkReading(reading));
    expectNamedPints(venueDrinkPricesFromUkReading(reading));
    expectNamedPints(extractPintPrices(menu));
    expectNamedPints(extractVenueDrinkPrices(menu));
    const nightly = factsFromPage(menu, fact).drinks.filter((row) => row.size === "pint");
    expectNamedPints(nightly.map(({ drink, priceGbp }) => ({ drinkName: drink, priceGbp })));
    for (const key of ["", "test-key"]) {
      vi.stubEnv("TYPESAFE_API_KEY", key);
      const harvested = await readVenueDrinkPricesForHarvest(menu, ctx);
      expectNamedPints(pintPricesFromUkReading(harvested.reading));
      expectNamedPints((await extractPintPricesForHarvest(menu, ctx)).prices);
      expectNamedPints((await extractVenueDrinkPricesForHarvest(menu, ctx)).drinks);
    }
    const judged = await readVenueDrinkPricesJudged(menu, ctx);
    expect(judged.kept).toHaveLength(4);
    expectNamedPints(pintPricesFromUkReading(judged));
    expectNamedPints(venueDrinkPricesFromUkReading(judged));
    expect(systemOneOutcome).toHaveBeenCalled();
  });
});

it("retains the reported wrapped serving description without a pint label", () => {
  const menu = "<p>Guinness draught £5.20<br>Served as two-thirds of a pint</p>" + siblings;
  expectNamedPints(extractPintPrices(menu));
  expectNamedPints(extractVenueDrinkPrices(menu));
});

it("names equal-price non-beer rows from each accepted item", () => {
  const menu = "Tanqueray gin £6.20; House red wine 175ml £6.20; Espresso martini £6.20";
  expect(venueDrinkPricesFromUkReading(readVenueDrinkPrices(menu))).toEqual([
    { drinkName: "Tanqueray gin", category: "gin", priceGbp: 6.2 },
    { drinkName: "House red wine 175ml", category: "wine", priceGbp: 6.2 },
    { drinkName: "Espresso martini", category: "cocktail", priceGbp: 6.2 },
  ]);
});

it("keeps the pint column and the explicitly stated pint after a half", () => {
  expect(extractPintPrices("Estrella Damm\n£4.00 | £6.80")).toEqual([
    { drinkName: "Estrella Damm", priceGbp: 6.8, servingSize: "pint" },
  ]);
  expect(extractPintPrices("Kernel Pale Ale 1/2 pint £3.10 Pint £6.20")).toEqual([
    { drinkName: "Kernel Pale Ale", priceGbp: 6.2, servingSize: "pint" },
  ]);
});
