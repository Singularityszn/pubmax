import { describe, expect, it } from "vitest";

import { factsFromPage } from "@/lib/harvest/tavilyNightlyPass";
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
