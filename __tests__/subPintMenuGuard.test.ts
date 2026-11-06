import { describe, expect, it } from "vitest";

import { factsFromPage } from "@/lib/harvest/tavilyNightlyPass";
import { extractPintPrices } from "@/lib/harvest/tavilyPintPrices";
import { extractVenueDrinkPrices } from "@/lib/harvest/tavilyVenueDrinkPrices";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

const fact = { sourceUrl: "https://example.test/drinks-menu/", seenOn: "2026-11-06" };
const namedPint = expect.objectContaining({ drinkLabel: "Guinness pint", priceGbp: 6.2 });

describe("a sub-pint serving in the item's own label never becomes a beer price", () => {
  // The Brownswood drinks menu, read on 21 Sep 2026, published this mixer row
  // as a £2.60 beer (venue-1vse4lh).
  const brownswood = [
    "Corona Cero 0.0% – £4.50",
    "~ 1/2 pint Tonic, Slim Tonic, Ginger Ale / Beer- £2.60",
    "Guinness pint £6.20",
  ].join("\n");

  it("withholds the Brownswood half-pint mixer row and keeps the named pint", () => {
    const reading = readVenueDrinkPrices(brownswood);
    expect(reading.kept.filter((row) => row.priceGbp === 2.6)).toEqual([]);
    expect(reading.kept).toEqual(expect.arrayContaining([namedPint]));
    expect(reading.drops).toContain("half-measure-not-a-pint");
  });

  it("lists the Brownswood row as a half, never a pint, for a curator", () => {
    const drinks = factsFromPage(brownswood, fact).drinks;
    expect(drinks.filter((row) => row.priceGbp === 2.6 && row.size === "pint")).toEqual([]);
    expect(drinks).toEqual(expect.arrayContaining([expect.objectContaining({ drink: "Guinness", size: "pint", priceGbp: 6.2 })]));
  });

  it.each([
    "½ pint Kernel Pale Ale, local brewery £3.10",
    "1/2 pint Kernel Pale Ale, local brewery £3.10",
    "1 / 2 pint Kernel Pale Ale, local brewery £3.10",
    "Half pint Kernel Pale Ale, local brewery £3.10",
  ])("withholds a half stated at the start of a long label: %s", (line) => {
    const reading = readVenueDrinkPrices(`${line}\nGuinness pint £6.20`);
    expect(reading.kept.filter((row) => row.priceGbp === 3.1)).toEqual([]);
    expect(reading.kept).toEqual(expect.arrayContaining([namedPint]));
  });

  it("withholds a third-pint row beside a named pint", () => {
    const text = "Kernel stout £2.10 (1/3)\nGuinness pint £6.20";
    expect(readVenueDrinkPrices(text).kept.filter((row) => row.priceGbp === 2.1)).toEqual([]);
    expect(factsFromPage(text, fact).drinks.filter((row) => row.priceGbp === 2.1 && row.size === "pint")).toEqual([]);
  });

  it("keeps a full pint printed after a half on the same line", () => {
    const kept = readVenueDrinkPrices("Kernel Pale Ale 1/2 pint £3.10 Pint £6.20").kept;
    expect(kept.filter((row) => row.priceGbp === 3.1)).toEqual([]);
    expect(kept).toEqual([expect.objectContaining({ category: "beer", priceGbp: 6.2 })]);
  });
});


describe("explicit serving sizes override pint wording", () => {
  it.each([
    "Kernel Pale Ale £3.10 (1/2 pint)",
    "Kernel Pale Ale £3.10 (½ pint)",
    "Kernel Pale Ale £3.10 (half pint)",
    "Kernel Pale Ale £3.10 (half a pint)",
    "Kernel Pale Ale ¾ pint £3.10",
    "Kernel Pale Ale 3/4 pint £3.10",
    "Kernel Pale Ale three-quarter pint £3.10",
    "Kernel Pale Ale ¼ pint £3.10",
    "Kernel Pale Ale 1/4 pint £3.10",
    "Kernel Pale Ale 1/10 pint £3.10",
    "Kernel Pale Ale 0.5 pint £3.10",
    "Kernel Pale Ale 0.75 pint £3.10",
    "Kernel Pale Ale 1⁄2 pint £3.10",
    "Kernel Pale Ale schooner £3.10",
    "Kernel Pale Ale £3.10 (schooner)",
  ])("never publishes a pint from %s", (item) => {
    const menu = `${item}\n\nGuinness pint £6.20`;
    expect(readVenueDrinkPrices(menu).kept.filter((row) => row.priceGbp === 3.1)).toEqual([]);
    expect(readVenueDrinkPrices(menu).kept).toContainEqual(namedPint);
    expect(factsFromPage(menu, fact).drinks.filter((row) => row.priceGbp === 3.1 && row.size === "pint")).toEqual([]);
    expect(extractPintPrices(menu).filter((row) => row.priceGbp === 3.1)).toEqual([]);
    expect(extractVenueDrinkPrices(menu).filter((row) => row.priceGbp === 3.1)).toEqual([]);
  });

  it.each(["(1/3 pint)", "(1/2 pint)", "(¾ pint)", "(schooner)"])(
    "retains the wrapped serving %s through every linewise reader", (serving) => {
      const menu = `Kernel stout pint £2.10\n${serving}\n\nGuinness pint £6.20`;
      expect(readVenueDrinkPrices(menu).kept.filter((row) => row.priceGbp === 2.1)).toEqual([]);
      expect(extractPintPrices(menu)).toEqual([
        { drinkName: "Guinness", priceGbp: 6.2, servingSize: "pint" },
      ]);
      expect(extractVenueDrinkPrices(menu)).toEqual([
        { drinkName: "Guinness", priceGbp: 6.2, category: "beer" },
      ]);
    },
  );
});
