// The bill check's one parser and one judge (lib/billCheck.ts): a model's read
// of a bill becomes priced lines, and those lines decide match, mismatch or
// unreadable against the price the drinker typed.

import { describe, expect, it } from "vitest";

import {
  BILL_CHECK_MAX_LINES,
  BILL_CHECK_RESULTS,
  cleanBillCheckResult,
  judgeBill,
  parseBillReadAnswer,
} from "@/lib/billCheck";

const bill = (lines: unknown, over: Record<string, unknown> = {}) => ({
  venue_name: "The Blackfriar",
  date: "2026-11-05",
  lines,
  ...over,
});

describe("parseBillReadAnswer", () => {
  it("keeps each priced line as a name and a price in pounds", () => {
    expect(
      parseBillReadAnswer(bill([
        { name: "Guinness", price_gbp: 6.2 },
        { name: "Salt and vinegar crisps", price_gbp: 1.5 },
      ])),
    ).toEqual({
      lines: [
        { name: "Guinness", priceGbp: 6.2 },
        { name: "Salt and vinegar crisps", priceGbp: 1.5 },
      ],
    });
  });

  it("never keeps the venue name or the date it was asked to read", () => {
    const read = parseBillReadAnswer(bill([{ name: "Guinness", price_gbp: 6.2 }]));
    expect(Object.keys(read)).toEqual(["lines"]);
  });

  it("drops a line with no price, a price that is not a number, or a price no bill line holds", () => {
    const read = parseBillReadAnswer(bill([
      { name: "Guinness" },
      { name: "Lager", price_gbp: "5.20" },
      { name: "Free tap water", price_gbp: 0 },
      { name: "Refund", price_gbp: -4 },
      { name: "Card total", price_gbp: Number.POSITIVE_INFINITY },
      { name: "Champagne magnum", price_gbp: 1200 },
      { name: "Pale ale", price_gbp: 5.2 },
    ]));
    expect(read.lines).toEqual([{ name: "Pale ale", priceGbp: 5.2 }]);
  });

  it("rounds a price to whole pence", () => {
    const read = parseBillReadAnswer(bill([{ name: "Stout", price_gbp: 5.199999 }]));
    expect(read.lines).toEqual([{ name: "Stout", priceGbp: 5.2 }]);
  });

  it("takes card digits and other long numbers out of a line name, and drops a line left empty", () => {
    const read = parseBillReadAnswer(bill([
      { name: "Visa **** 4921 1234", price_gbp: 6.2 },
      { name: "1234567890", price_gbp: 6.2 },
      { name: "  Camden   Hells <b>pint</b> ", price_gbp: 6.2 },
    ]));
    expect(read.lines).toEqual([
      { name: "Visa ****", priceGbp: 6.2 },
      { name: "Camden Hells bpint/b", priceGbp: 6.2 },
    ]);
    for (const line of read.lines) expect(line.name).not.toMatch(/\d{4}/);
  });

  it("caps a long name and a long bill", () => {
    const long = parseBillReadAnswer(bill([{ name: "A".repeat(200), price_gbp: 5 }]));
    expect(long.lines[0]?.name).toHaveLength(60);
    const many = parseBillReadAnswer(
      bill(Array.from({ length: 80 }, (_, i) => ({ name: `Beer ${i}`, price_gbp: 5 }))),
    );
    expect(many.lines).toHaveLength(BILL_CHECK_MAX_LINES);
  });

  it("reads a malformed answer as a bill with no lines", () => {
    expect(parseBillReadAnswer(null)).toEqual({ lines: [] });
    expect(parseBillReadAnswer("Guinness £6.20")).toEqual({ lines: [] });
    expect(parseBillReadAnswer({ lines: "Guinness £6.20" })).toEqual({ lines: [] });
    expect(parseBillReadAnswer({ lines: [null, 4, "x"] })).toEqual({ lines: [] });
  });
});

describe("judgeBill", () => {
  const read = (lines: Array<[string, number]>) => ({
    lines: lines.map(([name, priceGbp]) => ({ name, priceGbp })),
  });

  it("answers match when a line holds the submitted price to the penny, keeping only that line", () => {
    expect(judgeBill(read([["Crisps", 1.5], ["Guinness", 6.2], ["Lager", 5.8]]), 6.2, "Guinness")).toEqual({
      result: "match",
      lines: [{ name: "Guinness", priceGbp: 6.2 }],
    });
  });

  it("reads pounds and pence without a floating point miss", () => {
    expect(judgeBill(read([["Stout", 4.35]]), 4.35, "Stout").result).toBe("match");
    expect(judgeBill(read([["Stout", 0.1 + 0.2]]), 0.3, "Stout").result).toBe("match");
  });

  it("answers mismatch when the bill is readable and no line holds the price, keeping every line", () => {
    expect(judgeBill(read([["Guinness", 6.4], ["Crisps", 1.5]]), 6.2, "Guinness")).toEqual({
      result: "mismatch",
      lines: [
        { name: "Guinness", priceGbp: 6.4 },
        { name: "Crisps", priceGbp: 1.5 },
      ],
    });
  });

  it("answers unreadable, and keeps nothing, when no priced line could be read", () => {
    expect(judgeBill(read([]), 6.2, "Guinness")).toEqual({ result: "unreadable", lines: [] });
  });

  it("keeps one copy of a matching line printed twice", () => {
    expect(judgeBill(read([["Guinness", 6.2], ["Guinness", 6.2]]), 6.2, "Guinness").lines).toEqual([
      { name: "Guinness", priceGbp: 6.2 },
    ]);
  });

  it("does not approve Guinness because chips share the submitted amount", () => {
    expect(judgeBill(read([["Guinness", 6.2], ["Chips", 5.2]]), 5.2, "Guinness").result).toBe("mismatch");
    expect(judgeBill(read([["Chips", 5.2]]), 5.2, "Guinness").result).toBe("unreadable");
  });

  it("uses a serving only when the bill states it", () => {
    expect(judgeBill(read([["Guinness half pint", 5.2]]), 5.2, "Guinness", "pint").result).toBe("mismatch");
    expect(judgeBill(read([["Pint Guinness", 5.2]]), 5.2, "Guinness", "half").result).toBe("mismatch");
    expect(judgeBill(read([["Guinness half pint", 5.2]]), 5.2, "Guinness", "half").result).toBe("match");
    expect(judgeBill(read([["Guinness", 5.2]]), 5.2, "Guinness", "half").result).toBe("match");
    expect(judgeBill(read([["Merlot 175ml", 5.2]]), 5.2, "Merlot", "250ml").result).toBe("mismatch");
    expect(judgeBill(read([["Merlot 175 ml", 5.2]]), 5.2, "Merlot", "175ml").result).toBe("match");
  });

  it.each([
    ["Pint of lager", "Lager pint", "pint", "half"],
    ["Half of lager", "Lager half pint", "half", "pint"],
    ["Lager 1/2 pint", "1/2 lager", "half", "pint"],
    ["½ pint lager", "Lager ½", "half", "pint"],
    ["Single Jameson", "Jameson single", "single", "double"],
    ["Double Jameson", "Jameson double", "double", "single"],
    ["Bottle of Merlot", "Merlot bottle", "bottle", "175ml"],
    ["125 ml Merlot", "Merlot 125ml", "125ml", "250ml"],
    ["Merlot 175 ml reserve", "Merlot reserve 175ml", "175ml", "250ml"],
    ["250 ml Merlot", "Merlot 250ml", "250ml", "125ml"],
  ] as const)("interprets servings anywhere in %s and %s", (line, drink, measure, different) => {
    expect(judgeBill(read([[line, 5.2]]), 5.2, drink, measure).result).toBe("match");
    expect(judgeBill(read([[drink, 5.2]]), 5.2, line, measure).result).toBe("match");
    expect(judgeBill(read([[line, 5.2]]), 5.2, drink).result).toBe("match");
    expect(judgeBill(read([[line, 5.2]]), 5.2, drink, different).result).toBe("mismatch");
    expect(judgeBill(read([[drink, 5.2]]), 5.2, line, different).result).toBe("mismatch");
  });

  it("does not approve a single spirit as a double even when both names say single", () => {
    expect(judgeBill(read([["Single Jameson", 5.2]]), 5.2, "Single Jameson", "double").result).toBe("mismatch");
  });
});

describe("the bill check vocabulary", () => {
  it("is a closed set of three words", () => {
    expect([...BILL_CHECK_RESULTS]).toEqual(["match", "mismatch", "unreadable"]);
    expect(cleanBillCheckResult("match")).toBe("match");
    expect(cleanBillCheckResult("matched")).toBeUndefined();
    expect(cleanBillCheckResult(null)).toBeUndefined();
  });
});
