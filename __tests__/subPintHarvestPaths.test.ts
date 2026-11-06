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
  "&frac12; pint", "&frac13; pint", "&frac23; pint", "&frac14; pint", "&frac34; pint",
  "&frac15; pint", "&frac16; pint", "&frac18; pint", "&frac25; pint", "&frac35; pint",
  "&frac38; pint", "&frac45; pint", "&frac56; pint", "&frac58; pint", "&frac78; pint",
  "&frac12;pint", "&frac34;pint",
  "&#190; pint", "&#x2154; pint", "⅟ pint", "↉ pint", "⁴⁄₅ pint",
  "third", "quarter", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "fractional measure", "served as a pint", "small serving", "taster measure", "pour size unspecified",
];
const layouts: Array<[string, (serving: string) => string]> = [
  ["before the price", (serving) => `<p>Kernel stout ${serving} £6.20</p>`],
  ["after the price", (serving) => `<p>Kernel stout pint £6.20 (${serving})</p>`],
  ["in a wrapped qualifier", (serving) => `<p>Kernel stout pint £6.20<br>(${serving})</p>`],
  ["in a plain wrapped qualifier", (serving) => `Kernel stout pint £6.20\n(${serving})\n\n`],
  ["in a wrapped description", (serving) => `<p>Kernel stout draught £6.20<br>Served as ${serving}</p>`],
  ["in a plain newline description", (serving) => `Kernel stout pint £6.20\nServed as ${serving}\n\n`],
  ["in a plain preceding description", (serving) => `Served as ${serving}\nKernel stout pint £6.20\n\n`],
  ["in a plain newline note", (serving) => `Kernel stout pint £6.20\nServing: ${serving}\n\n`],
  ["in a plain preceding note", (serving) => `Serving: ${serving}\nKernel stout pint £6.20\n\n`],
  ["in a preceding description", (serving) => `<p>Served as ${serving}<br>Kernel stout pint £6.20</p>`],
  ["between two pints", (serving) => `Kernel stout pint £6.20\n(${serving})\nHawkstone pint £6.40\n\n`],
  ["before a wrapped name", (serving) => `<p>${serving}<br>Kernel stout<br>pint £6.20</p>`],
  ["before a plain wrapped name", (serving) => `${serving}\nKernel stout\npint £6.20\n\n`],
  ["after a plain wrapped description", (serving) => `Kernel stout pint £6.20\nOn tap\nServed as ${serving}\n\n`],
  ["before an equal-price sibling", (serving) => `<p>Kernel stout £6.20 (${serving}); Hawkstone pint £6.20</p>`],
  ["after a hard separator", (serving) => `<p>Kernel stout pint £6.20 | ${serving}</p>`],
  ["before a preceding sentence boundary", (serving) => `<p>Served as ${serving}. Kernel stout pint £6.20</p>`],
  ["in a following paragraph", (serving) => `<p>Kernel stout pint £6.20</p><p>Served as ${serving}</p>`],
  ["in a preceding paragraph", (serving) => `<p>Served as ${serving}</p><p>Kernel stout pint £6.20</p>`],
  ["after two prices on one line", (serving) => `<p>Kernel stout pint £6.20; Hawkstone pint £6.40 | ${serving}</p>`],
  ["between two priced paragraphs", (serving) => `<p>Kernel stout pint £6.20</p><p>${serving}</p><p>Hawkstone pint £6.40</p>`],
  ["after a nested table price", (serving) => `<table><tr><td><p>Kernel stout pint £6.20</p><p>On tap</p></td><td><p>Special serving</p><p>${serving}</p></td></tr></table>`],
  ["before a nested table price", (serving) => `<table><tr><td><p>${serving}</p><p>Special serving</p></td><td><p>On tap</p><p>Kernel stout pint £6.20</p></td></tr></table>`],
  ["after a nested list price", (serving) => `<ul><li><p>Kernel stout pint £6.20</p><p>On tap</p><p>Special serving</p><p>${serving}</p></li></ul>`],
  ["before a nested list price", (serving) => `<ul><li><p>${serving}</p><p>Special serving</p><p>On tap</p><p>Kernel stout pint £6.20</p></li></ul>`],
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

async function expectOnlyFullPints(menu: string): Promise<void> {
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
}

describe.each(layouts)("the required serving exclusions %s", (_layout, item) => {
  it.each(servings)("publishes only the four full pints beside %s through every path", async (serving) => {
    const menu = item(serving) + "<p>Other drinks</p>" + siblings;
    await expectOnlyFullPints(menu);
  });
});

it.each([
  "Guinness 284ml £3.00 (568ml also available)",
  "Guinness 568ml £3.00 (284ml also available)",
  "Guinness pint 284ml £3.00",
  "Guinness pint £3.00 (284ml)",
  "Guinness pint £3.00 (568ml / 284ml)",
  "Guinness pint £3.00 (284 ml / 568 ml)",
  "Guinness 284ml £3.00<br>(568ml also available)",
  "Guinness 568ml £3.00<br>(284ml also available)",
  "Guinness 1000ml £3.00 (568ml also available)",
  "Guinness 0.568ml £3.00 (568ml also available)",
  "Guinness 56.8ml £3.00 (568ml also available)",
  "Guinness 56,8ml £3.00 (568ml also available)",
  "Guinness 568ml bottle £3.00",
  "Guinness pint £3.00 (330ml can)",
])("withholds non-pint volumes through every path: %s", async (item) => {
  await expectOnlyFullPints(`<p>${item}</p><p>Other drinks</p>${siblings}`);
});

it.each([
  "Kernel stout 568ml £6.20",
  "Kernel stout 568 ml £6.20",
  "Kernel stout 568ml £6.20 (568ml)",
])("keeps the UK pint volume: %s", async (item) => {
  const menu = `<p>${item}</p>${siblings}`;
  const expected = [{ drinkName: "Kernel stout", priceGbp: 6.2 }, ...fullPints];
  const named = (rows: Array<{ drinkName: string; priceGbp: number }>) => (
    rows.map(({ drinkName, priceGbp }) => ({ drinkName, priceGbp }))
  );
  expect(readVenueDrinkPrices(menu).kept.map(({ category, priceGbp }) => ({ category, priceGbp }))).toEqual(
    expected.map(({ priceGbp }) => ({ category: "beer", priceGbp })),
  );
  expect(named(extractPintPrices(menu))).toEqual(expected);
  expect(named(extractVenueDrinkPrices(menu))).toEqual(expected);
  expect(factsFromPage(menu, fact).drinks.map(({ drink, size, priceGbp }) => ({ drink, size, priceGbp }))).toEqual(
    expected.map(({ drinkName, priceGbp }) => ({ drink: drinkName, size: "pint", priceGbp })),
  );
  for (const key of ["", "test-key"]) {
    vi.stubEnv("TYPESAFE_API_KEY", key);
    expect(named((await extractPintPricesForHarvest(menu, ctx)).prices)).toEqual(expected);
    expect(named((await extractVenueDrinkPricesForHarvest(menu, ctx)).drinks)).toEqual(expected);
  }
  expect(named(pintPricesFromUkReading(await readVenueDrinkPricesJudged(menu, ctx)))).toEqual(expected);
});

it("retains the reported wrapped serving description without a pint label", () => {
  const menu = "<p>Guinness draught £5.20<br>Served as two-thirds of a pint</p><p>Other drinks</p>" + siblings;
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

it("keeps an unqualified pint column and holds a row that names a half", () => {
  expect(extractPintPrices("Estrella Damm\n£4.00 | £6.80")).toEqual([
    { drinkName: "Estrella Damm", priceGbp: 6.8, servingSize: "pint" },
  ]);
  expect(extractPintPrices("Kernel Pale Ale 1/2 pint £3.10 Pint £6.20")).toEqual([]);
});
