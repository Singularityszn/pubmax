import { describe, expect, it } from "vitest";

import { readChainPintPrices } from "@/lib/harvest/chainMenuPrices";
import { factsFromPage } from "@/lib/harvest/tavilyNightlyPass";
import { pageStatesADrinksList, readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

const fact = { sourceUrl: "https://eastbrookpub.co.uk/drink-menu.html", seenOn: "2026-10-23" };
const measures = [
  ["1/3", "one-third"], ["1 / 3", "one-third"], ["⅓", "one-third"],
  ["one-third", "one-third"], ["one third", "one-third"],
  ["2/3", "two-thirds"], ["2 / 3", "two-thirds"], ["⅔", "two-thirds"],
  ["two-thirds", "two-thirds"], ["two thirds", "two-thirds"],
] as const;
const separators = [
  ...[",", ".", ";", ":", "|", "•", "·", "!", "?"].flatMap((mark) =>
    [mark, `${mark} `, ` ${mark}`, ` ${mark} `]),
  " - ", "  -  ", "\t-\t",
];
const context = ["Madri pint £6.40", "Neck Oil pint £6.80", "House red wine 175ml £7.50"];

describe("fraction ownership at printed item boundaries", () => {
  it.each(measures)("retains bare and parenthesized %s curator measures", (measure, sizeDetail) => {
    for (const serving of [measure, `(${measure})`]) {
      for (const item of [`${serving} Kernel stout £6.00`, `Kernel stout ${serving} £6.00`, `Kernel stout £6.00 ${serving}`]) {
        for (const prefix of ["", ...separators.map((separator) => `Guinness pint £6.20${separator} `)]) {
          const line = `${prefix}${item}`;
          const drinks = factsFromPage([line, ...context].join("\n"), fact).drinks;
          expect(drinks.filter(({ drink }) => drink === "Kernel stout"), line).toEqual([
            { drink: "Kernel stout", size: "unstated", sizeDetail, priceGbp: 6, standing: "listed", ...fact },
          ]);
          const reading = readVenueDrinkPrices([line, ...context].join("\n"), "text");
          expect(reading.kept.some(({ drinkLabel }) => drinkLabel?.includes("Kernel")), line).toBe(false);
          expect(reading.drops, line).toContain("fractional-measure-not-a-pint");
        }
      }
    }
  });

  it.each(measures)("keeps %s suffixes with the preceding price", (measure, sizeDetail) => {
    for (const separator of separators) {
      for (const amount of ["£6", "£6.0", "£6.00"]) {
        for (const suffix of [measure, `${measure} pint`, `(${measure})`, `(${measure} pint)`]) {
          for (const fullName of ["Guinness", "Guinness pint"]) {
            const line = `Kernel stout ${amount} ${suffix}${separator}${fullName} £6.20`;
            for (const format of ["text", "html"] as const) {
              const lines = [line, ...context];
              const body = format === "html" ? lines.map((row) => `<p>${row}</p>`).join("") : lines.join("\n");
              const reading = readVenueDrinkPrices(body, format);
              expect(reading.kept.map(({ drinkLabel, category, priceGbp }) => ({ drinkLabel, category, priceGbp })), line)
                .toEqual([
                  { drinkLabel: fullName, category: "beer", priceGbp: 6.2 },
                  { drinkLabel: "Madri pint", category: "beer", priceGbp: 6.4 },
                  { drinkLabel: "Neck Oil pint", category: "beer", priceGbp: 6.8 },
                  { drinkLabel: "House red wine", category: "wine", priceGbp: 7.5 },
                ]);
              expect(reading.drops, line).toEqual(["fractional-measure-not-a-pint"]);
              expect(pageStatesADrinksList(reading), line).toBe(true);
            }
            const drinks = factsFromPage([line, ...context].join("\n"), fact).drinks;
            expect(drinks.filter(({ drink }) => drink === "Kernel stout"), line).toEqual([
              { drink: "Kernel stout", size: "unstated", sizeDetail, priceGbp: 6, standing: "listed", ...fact },
            ]);
            expect(drinks.filter(({ drink }) => drink.includes("Guinness")), line).toEqual(fullName.endsWith("pint") ? [
              { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6.2, standing: "listed", ...fact },
            ] : []);
            expect(readChainPintPrices(`<p>${line}</p>`).kept.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp })), line)
              .toEqual([{ drinkLabel: fullName, priceGbp: 6.2 }]);
          }
        }
      }
    }
  });

  it.each(measures)("keeps a true %s prefix with the following drink", (measure, sizeDetail) => {
    for (const separator of separators) {
      const boundary = separator.trim() === "." ? `${separator} ` : separator;
      const line = `Guinness pint £6.2${boundary}${measure} pint Kernel stout £6.00`;
      const reading = readVenueDrinkPrices(line, "text");
      expect(reading.kept.map(({ drinkLabel, category, priceGbp }) => ({ drinkLabel, category, priceGbp })), line)
        .toEqual([{ drinkLabel: "Guinness pint", category: "beer", priceGbp: 6.2 }]);
      expect(reading.drops, line).toEqual(["fractional-measure-not-a-pint"]);
      expect(factsFromPage(line, fact).drinks, line).toEqual([
        { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6.2, standing: "listed", ...fact },
        { drink: "Kernel stout", size: "unstated", sizeDetail, priceGbp: 6, standing: "listed", ...fact },
      ]);
    }
  });
});
