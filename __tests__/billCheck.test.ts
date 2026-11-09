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

  it("preserves all product digits until judging", () => {
    const read = parseBillReadAnswer(bill([
      { name: "Visa **** 4921 1234", price_gbp: 6.2 },
      { name: "1234567890", price_gbp: 6.2 },
      { name: "  Camden   Hells <b>pint</b> ", price_gbp: 6.2 },
    ]));
    expect(read.lines).toEqual([
      { name: "Visa **** 4921 1234", priceGbp: 6.2 },
      { name: "1234567890", priceGbp: 6.2 },
      { name: "Camden Hells bpint/b", priceGbp: 6.2 },
    ]);
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

  // A one-tap price names only its category ("Beer"). A bill line names the
  // drink when its product belongs to that category, so "Pint of Guinness"
  // can confirm a Beer price; an item of another category never can.
  it("matches a bare category against a bill line whose product is in that category", () => {
    expect(judgeBill(read([["Pint of Guinness", 6.2], ["Crisps", 1.5]]), 6.2, "Beer", "pint")).toEqual({
      result: "match",
      lines: [{ name: "Pint of Guinness", priceGbp: 6.2 }],
    });
    expect(judgeBill(read([["Peroni", 6.2]]), 6.2, "Beer").result).toBe("match");
  });

  it("reads a different price on a same-category line as a bare-category mismatch", () => {
    expect(judgeBill(read([["Pint of Guinness", 6.8], ["Crisps", 1.5]]), 6.2, "Beer", "pint").result).toBe(
      "mismatch",
    );
    expect(judgeBill(read([["Guinness half pint", 6.2]]), 6.2, "Beer", "pint").result).toBe("mismatch");
  });

  it.each(["Guinness 0.0", "Heineken 0.0%"])("preserves the alcohol-free category of %s", (name) => {
    const lines = read([[name, 5.5]]);
    expect(judgeBill(lines, 5.5, "Beer", "pint").result).toBe("unreadable");
    expect(judgeBill(lines, 5.5, "Alcohol-free", "pint").result).toBe("match");
  });

  it.each(["Breakfast Stout", "Chocolate Porter"])("identifies the drink %s despite its food modifier", (name) => {
    const lines = read([[name, 5.2]]);
    expect(judgeBill(lines, 5.2, name, "pint").result).toBe("match");
  });

  it.each(["(cask)", "[keg]", "- on tap", "- guest"])("identifies drinks with the trailing descriptor %s", (suffix) => {
    const name = `Breakfast Stout ${suffix}`;
    const lines = read([[name, 5.2]]);
    expect(judgeBill(lines, 5.2, name, "pint").result).toBe("match");
    expect(judgeBill(lines, 5.2, "Beer", "pint").result).toBe("match");
    const food = `Guinness pie ${suffix}`;
    expect(judgeBill(read([[food, 5.2]]), 5.2, food, "pint").result).toBe("unreadable");
    expect(judgeBill(read([[food, 5.2]]), 5.2, "Beer", "pint").result).toBe("unreadable");
  });

  it.each(["(cask)", "[keg]", "- on tap", "- guest"])("checks servings independently of the descriptor %s", (descriptor) => {
    const plain = read([["Guinness", 3.5]]);
    for (const serving of ["half", "third", "schooner", "small", "carafe", "pint", "single", "double", "bottle", "can"]) {
      const different = serving === "pint" ? "half" : "pint";
      for (const name of [
        `Guinness ${serving} ${descriptor}`,
        `${serving} ${descriptor} Guinness`,
        `${descriptor} Guinness ${serving}`,
        `Guinness ${descriptor} ${serving}`,
      ]) {
        const lines = read([[name, 3.5]]);
        expect(judgeBill(lines, 3.5, "Beer", different).result).toBe("mismatch");
        expect(judgeBill(lines, 3.5, "Guinness", different).result).toBe("mismatch");
        expect(judgeBill(plain, 3.5, name, different).result).toBe("mismatch");
        expect(judgeBill(lines, 3.5, name, different).result).toBe("mismatch");
        expect(judgeBill(read([[`Guinness ${different}`, 3.5]]), 3.5, "Guinness", "other", name).result).toBe("mismatch");
        expect(judgeBill(lines, 3.5, "Beer", "other", serving)).toEqual({ result: "match", lines: lines.lines });
        expect(judgeBill(lines, 3.5, "Guinness", "other", serving).result).toBe("match");
        expect(judgeBill(plain, 3.5, name, "other", serving).result).toBe("match");
        expect(judgeBill(lines, 3.5, name, "other", serving).result).toBe("match");
        expect(judgeBill(lines, 3.5, "Guinness", "other", name).result).toBe("match");
      }
    }
    for (const name of [`Guinness ${descriptor}`, `${descriptor} Guinness`]) {
      const lines = read([[name, 3.5]]);
      expect(judgeBill(lines, 3.5, "Beer", "pint")).toEqual({ result: "match", lines: lines.lines });
      expect(judgeBill(lines, 3.5, "Guinness", "pint").result).toBe("match");
      expect(judgeBill(plain, 3.5, name, "pint").result).toBe("match");
    }
  });

  it.each(["Small Beer", "Small Beer Lager", "Double IPA", "Single Malt Whisky"])(
    "preserves the protected product %s around descriptors", (product) => {
      for (const name of [`${product} (cask)`, `[keg] ${product}`, `${product} - guest pint`]) {
        expect(judgeBill(read([[name, 5.2]]), 5.2, product, "pint").result).toBe("match");
        expect(judgeBill(read([[product, 5.2]]), 5.2, name, "pint").result).toBe("match");
      }
    },
  );

  it("identifies a category from the start of a compound drink name", () => {
    expect(judgeBill(read([["Pale Ale", 5.5]]), 5.5, "Beer", "pint").result).toBe("match");
    expect(judgeBill(read([["Pale Ale", 6.5]]), 5.5, "Beer", "pint").result).toBe("mismatch");
  });

  it("preserves Small Beer Lager as a product for named and category prices", () => {
    const product = "Small Beer Lager";
    for (const name of [product, `${product} pint`, `Pint ${product}`]) {
      const lines = read([[name, 5.2]]);
      expect(judgeBill(lines, 5.2, product, "pint")).toEqual({ result: "match", lines: lines.lines });
      expect(judgeBill(lines, 5.2, "Beer", "pint").result).toBe("match");
      expect(judgeBill(read([[product, 5.2]]), 5.2, name, "pint").result).toBe("match");
      expect(judgeBill(lines, 5.2, "Beer Lager", "pint").result).toBe("unreadable");
      expect(judgeBill(lines, 5.3, product, "pint").result).toBe("mismatch");
    }
    const half = read([[`${product} half`, 5.2]]);
    expect(judgeBill(half, 5.2, product, "half").result).toBe("match");
    expect(judgeBill(half, 5.2, "Beer", "half").result).toBe("match");
    expect(judgeBill(half, 5.2, product, "pint").result).toBe("mismatch");
    expect(judgeBill(read([[product, 5.2]]), 5.2, `${product} half`, "half").result).toBe("match");
  });

  it.each([
    ["Half", "half"], ["Third", "third"], ["Schooner", "schooner"],
    ["Small", "small"], ["Halves", "half"], ["Carafe", "carafe"],
    ["Bottle", "bottle"], ["Can", "can"], ["Single", "single"],
    ["Double", "double"], ["Pint", "pint"],
  ])("keeps the leading serving in %s Lager explicit in every input", (serving, label) => {
    const name = `${serving} Lager`;
    const lines = read([[name, 3.5]]);
    const plain = read([["Lager", 3.5]]);
    const different = label === "pint" ? "half" : "pint";
    expect(judgeBill(lines, 3.5, "Beer", different).result).toBe("mismatch");
    expect(judgeBill(lines, 3.5, "Lager", different).result).toBe("mismatch");
    expect(judgeBill(plain, 3.5, name, different).result).toBe("mismatch");
    expect(judgeBill(lines, 3.5, name, different).result).toBe("mismatch");
    expect(judgeBill(lines, 3.5, "Beer", "other", label).result).toBe("match");
    expect(judgeBill(plain, 3.5, name, "other", label).result).toBe("match");
    expect(judgeBill(lines, 3.5, name, "other", label).result).toBe("match");
    expect(judgeBill(read([[`Lager ${different}`, 3.5]]), 3.5, "Lager", "other", name).result).toBe("mismatch");
    expect(judgeBill(lines, 3.5, "Lager", "other", name).result).toBe("match");
  });

  it.each(["Small Beer", "Half Moon IPA", "Third Wheel Bitter", "Other Half Green Diamond"])(
    "preserves the protected product name %s", (product) => {
      for (const name of [product, `${product} pint`, `Pint ${product}`]) {
        expect(judgeBill(read([[name, 5.2]]), 5.2, product, "pint").result).toBe("match");
        expect(judgeBill(read([[product, 5.2]]), 5.2, name, "pint").result).toBe("match");
      }
    },
  );

  it.each([
    "Beer battered fish", "Fish in beer batter", "Steak and ale pie",
    "Guinness pie", "Guinness burger", "Guinness fish", "Guinness chips",
    "Guinness battered", "Guinness sandwich", "Guinness cake",
  ])(
    "does not treat the food line %s as a Beer price", (name) => {
      expect(judgeBill(read([[name, 5.5]]), 5.5, "Beer", "pint").result).toBe("unreadable");
      expect(judgeBill(read([[name, 5.5]]), 5.5, name, "pint").result).toBe("unreadable");
      expect(judgeBill(read([[`Pint of ${name}`, 5.5]]), 5.5, "Beer", "pint").result).toBe("unreadable");
    },
  );

  it.each([
    "2/3 pint Guinness", "Guinness third", "Heineken 330ml", "Heineken 33cl",
    "Heineken 0.33l", "Bottle of Peroni", "Peroni bottled", "Can of Heineken", "Heineken canned",
  ])("does not verify a pint from the explicit non-pint line %s", (name) => {
    const lines = read([[name, 5.5]]);
    expect(judgeBill(lines, 5.5, "Beer", "pint").result).not.toBe("match");
    expect(judgeBill(lines, 5.5, name, "pint").result).not.toBe("match");
    expect(judgeBill(read([["Heineken", 5.5]]), 5.5, name, "pint").result).not.toBe("match");
  });

  it.each([
    "1/3-pint", "2/3-pint", "⅓-pint", "⅔-pint",
    "1/3 pint", "2/3 pint", "⅓ pint", "⅔ pint", "a third of a pint",
    "(1/3 pint)", "(⅓ pint)",
  ])("never verifies a full pint from %s on either side", (serving) => {
    for (const name of [`${serving} Guinness`, `Guinness ${serving}`]) {
      const lines = read([[name, 5.5]]);
      expect(judgeBill(lines, 5.5, "Beer", "pint").result).not.toBe("match");
      expect(judgeBill(lines, 5.5, name, "pint").result).not.toBe("match");
      expect(judgeBill(lines, 5.5, "Guinness", "pint").result).not.toBe("match");
      expect(judgeBill(read([["Guinness", 5.5]]), 5.5, name, "pint").result).not.toBe("match");
    }
  });

  it("never lets an item of another category confirm a bare category", () => {
    expect(judgeBill(read([["Chips", 6.2]]), 6.2, "Beer").result).toBe("unreadable");
    expect(judgeBill(read([["House Merlot 175ml", 6.2]]), 6.2, "Beer").result).toBe("unreadable");
    expect(judgeBill(read([["Pint of Guinness", 6.8], ["Chips", 6.2]]), 6.2, "Beer").result).toBe("mismatch");
  });

  it("does not approve Guinness because chips share the submitted amount", () => {
    expect(judgeBill(read([["Guinness", 6.2], ["Chips", 5.2]]), 5.2, "Guinness").result).toBe("mismatch");
    expect(judgeBill(read([["Chips", 5.2]]), 5.2, "Guinness").result).toBe("unreadable");
  });

  it.each([
    ["(", ")"], ["[", "]"], [",", ","], ["-", "-"],
    ["/", "/"], [":", ":"], ["\u2013", "\u2013"], ["\u2014", "\u2014"],
  ])("recognises servings bounded by %s and %s in every input", (open, close) => {
    for (const [serving, label, different] of [
      ["pint", "pint", "half"], ["Half", "half", "pint"],
      ["schooner", "schooner", "pint"], ["1/3 pint", "third", "half"],
      ["0.33l", "330ml", "half"],
    ]) {
      const wrapped = `${open}${serving}${close}`;
      const plain = read([["Lager", 3.5]]);
      for (const name of [`Lager ${wrapped}`, `${wrapped} Lager`]) {
        const lines = read([[name, 3.5]]);
        expect(judgeBill(lines, 3.5, "Beer", "other", different).result).toBe("mismatch");
        expect(judgeBill(lines, 3.5, "Lager", "other", different).result).toBe("mismatch");
        expect(judgeBill(plain, 3.5, name, "other", different).result).toBe("mismatch");
        expect(judgeBill(lines, 3.5, "Beer", "other", label).result).toBe("match");
        expect(judgeBill(lines, 3.5, "Lager", "other", label).result).toBe("match");
        expect(judgeBill(plain, 3.5, name, "other", label).result).toBe("match");
      }
      expect(judgeBill(read([[`Lager ${different}`, 3.5]]), 3.5, "Lager", "other", wrapped).result).toBe("mismatch");
      expect(judgeBill(read([[`Lager ${label}`, 3.5]]), 3.5, "Lager", "other", wrapped).result).toBe("match");
    }
    expect(judgeBill(read([[`Guinness ${open}pint${close}`, 3.5]]), 3.5, "Beer", "half").result).toBe("mismatch");
    expect(judgeBill(read([[`${open}Half${close} Lager`, 3.5]]), 3.5, "Beer", "pint").result).toBe("mismatch");
    for (const product of ["Small Beer Lager", "Double IPA", "Single Malt Whisky"]) {
      const name = `${open}${product}${close}`;
      expect(judgeBill(read([[name, 5.2]]), 5.2, product, "pint").result).toBe("match");
    }
  });

  it("uses a serving only when the bill states it", () => {
    expect(judgeBill(read([["Guinness half pint", 5.2]]), 5.2, "Guinness", "pint").result).toBe("mismatch");
    expect(judgeBill(read([["Pint Guinness", 5.2]]), 5.2, "Guinness", "half").result).toBe("mismatch");
    expect(judgeBill(read([["Guinness half pint", 5.2]]), 5.2, "Guinness", "half").result).toBe("match");
    expect(judgeBill(read([["Guinness", 5.2]]), 5.2, "Guinness", "half").result).toBe("match");
    expect(judgeBill(read([["Merlot 175ml", 5.2]]), 5.2, "Merlot", "250ml").result).toBe("mismatch");
    expect(judgeBill(read([["Merlot 175 ml", 5.2]]), 5.2, "Merlot", "175ml").result).toBe("match");
  });

  it.each(["330ml", "33cl", "0.33l"])("uses the custom serving label %s on both sides of a bill check", (label) => {
    expect(judgeBill(read([["Guinness 330ml", 3.5]]), 3.5, "Guinness", "other", label).result).toBe("match");
    expect(judgeBill(read([["Guinness pint", 3.5]]), 3.5, "Guinness", "other", label).result).toBe("mismatch");
    expect(judgeBill(read([["Guinness 330ml", 3.5]]), 3.5, "Guinness 330ml", "other", label).result).toBe("match");
    expect(judgeBill(read([["Guinness", 3.5]]), 3.5, "Guinness pint", "other", label).result).toBe("mismatch");
    expect(judgeBill(read([["Guinness 330ml", 3.5]]), 3.5, "Beer", "other", label).result).toBe("match");
  });

  it.each([
    "third", "1/3-pint", "⅓ pint", "a third of a pint", "2/3 pint", "3/4 pint",
    "330ml", "33cl", "0.33l", "0.33 litres", "bottled", "canned", "can", "bottle",
  ])("rejects %s as a half on either side of the bill check", (serving) => {
    for (const name of [`Guinness ${serving}`, `${serving} Guinness`]) {
      const lines = read([[name, 3.5]]);
      expect(judgeBill(lines, 3.5, "Beer", "half").result).toBe("mismatch");
      expect(judgeBill(lines, 3.5, "Guinness", "half").result).toBe("mismatch");
      expect(judgeBill(read([["Guinness", 3.5]]), 3.5, name, "half").result).toBe("mismatch");
      expect(judgeBill(lines, 3.5, name, "half").result).toBe("mismatch");
    }
  });

  it.each(["half pint", "1/2-pint", "½ pint"])("accepts a half stated as %s", (serving) => {
    const lines = read([[`Guinness ${serving}`, 3.5]]);
    expect(judgeBill(lines, 3.5, "Beer", "half").result).toBe("match");
    expect(judgeBill(lines, 3.5, "Guinness", "half").result).toBe("match");
  });

  it.each([
    ["schooner", "schooner"],
    ["halves", "half"],
    ["small", "small"],
    ["carafe", "carafe"],
  ])("checks the supported serving %s in names and custom labels", (serving, label) => {
    const plain = read([["Guinness", 3.5]]);
    for (const name of [`Guinness ${serving}`, `${serving} Guinness`]) {
      const lines = read([[name, 3.5]]);
      expect(judgeBill(lines, 3.5, "Beer", "pint").result).toBe("mismatch");
      expect(judgeBill(lines, 3.5, "Guinness", "pint").result).toBe("mismatch");
      expect(judgeBill(plain, 3.5, name, "pint").result).toBe("mismatch");
      expect(judgeBill(lines, 3.5, name, "pint").result).toBe("mismatch");
      expect(judgeBill(lines, 3.5, "Beer", "other", label).result).toBe("match");
      expect(judgeBill(lines, 3.5, "Guinness", "other", label).result).toBe("match");
      expect(judgeBill(plain, 3.5, name, "other", label).result).toBe("match");
      expect(judgeBill(lines, 3.5, name, "other", label).result).toBe("match");
      expect(judgeBill(read([["Guinness pint", 3.5]]), 3.5, "Guinness", "other", serving).result).toBe("mismatch");
      for (const different of ["schooner", "half", "small", "carafe"].filter((other) => other !== label)) {
        expect(judgeBill(lines, 3.5, "Beer", "other", different).result).toBe("mismatch");
        expect(judgeBill(plain, 3.5, name, "other", different).result).toBe("mismatch");
      }
      expect(judgeBill(lines, 3.5, "Beer", "half").result).toBe(label === "half" ? "match" : "mismatch");
    }
    expect(judgeBill(read([[`Guinness ${label}`, 3.5]]), 3.5, "Guinness", "other", serving).result).toBe("match");
  });

  it.each([
    ["quarter", ["quarter", "one quarter", "1/4 pint", "¼ pint", "142ml", "14.2cl", "0.142l"], "half"],
    ["third", ["third", "one third", "1/3 pint", "1/3-pint", "⅓ pint", "a third of a pint", "2/6 pint", "189ml", "18.94cl"], "two-thirds"],
    ["two-thirds", ["two thirds", "two-thirds", "2/3 pint", "2/3-pint", "⅔ pint", "two thirds of a pint", "4/6 pint", "379ml"], "half"],
    ["half", ["half", "half pint", "1/2 pint", "1/2-pint", "½ pint", "a half of a pint", "one-half pint", "two quarters", "2/4 pint", "284ml"], "third"],
    ["3/4", ["three quarters", "three-quarters", "3/4 pint", "¾ pint", "6/8 pint", "426ml"], "quarter"],
    ["pint", ["pint", "4/4 pint", "three thirds", "568ml", "56.8cl", "0.568l", "567.9ml"], "half"],
  ] as const)("compares equivalent spellings of %s across labels and drink names", (label, spellings, different) => {
    for (const spelling of spellings) {
      for (const name of [`Guinness ${spelling}`, `${spelling} Guinness`]) {
        const lines = read([[name, 3.5]]);
        expect(judgeBill(lines, 3.5, "Guinness", "other", label).result).toBe("match");
        expect(judgeBill(lines, 3.5, "Beer", "other", label).result).toBe("match");
        expect(judgeBill(read([[`Guinness ${label}`, 3.5]]), 3.5, "Guinness", "other", spelling).result).toBe("match");
        expect(judgeBill(lines, 3.5, `Guinness ${label}`).result).toBe("match");
        expect(judgeBill(read([[`Guinness ${label}`, 3.5]]), 3.5, name).result).toBe("match");
        expect(judgeBill(lines, 3.5, name, "other", label).result).toBe("match");
        expect(judgeBill(lines, 3.5, "Guinness", "other", different).result).toBe("mismatch");
        expect(judgeBill(lines, 3.6, "Guinness", "other", label).result).toBe("mismatch");
      }
    }
  });

  it.each([
    ["half", "two quarters"],
    ["half", "284ml"],
    ["half", "28.4cl"],
    ["half", "0.284l"],
    ["pint", "three thirds"],
    ["pint", "567.9ml"],
  ] as const)("compares fixed measure %s with the equivalent volume %s", (measure, serving) => {
    const lines = read([[`Guinness ${serving}`, 3.5]]);
    expect(judgeBill(lines, 3.5, "Guinness", measure).result).toBe("match");
    expect(judgeBill(lines, 3.5, "Beer", measure).result).toBe("match");
    expect(judgeBill(read([["Guinness", 3.5]]), 3.5, `Guinness ${serving}`, measure).result).toBe("match");
    expect(judgeBill(lines, 3.5, `Guinness ${serving}`, measure).result).toBe("match");
    expect(judgeBill(lines, 3.5, "Guinness", measure === "half" ? "pint" : "half").result).toBe("mismatch");
  });

  it.each(["17.5cl", "0.175l", "0.175 litres"])("compares the volume in %s with glass measures", (serving) => {
    const lines = read([[`Merlot ${serving}`, 5.2]]);
    expect(judgeBill(lines, 5.2, "Merlot", "175ml").result).toBe("match");
    expect(judgeBill(lines, 5.2, "Merlot", "250ml").result).toBe("mismatch");
    expect(judgeBill(read([["Merlot", 5.2]]), 5.2, `Merlot ${serving}`, "175ml").result).toBe("match");
    expect(judgeBill(read([["Merlot", 5.2]]), 5.2, `Merlot ${serving}`, "250ml").result).toBe("mismatch");
  });

  it.each(["pint", "half", "125ml", "175ml", "250ml", "bottle", "single", "double", "other"] as const)(
    "does not accept a third or a 330ml serving for measure %s", (measure) => {
      for (const name of ["Guinness third", "Guinness 330ml"]) {
        expect(judgeBill(read([[name, 3.5]]), 3.5, "Beer", measure).result).toBe("mismatch");
      }
    },
  );

  it.each(["568ml", "56.8cl", "0.568l"])("keeps %s compatible with a pint", (serving) => {
    expect(judgeBill(read([[`Guinness ${serving}`, 5.2]]), 5.2, "Beer", "pint").result).toBe("match");
  });

  it.each(["bottle", "bottled", "bottles"])("keeps %s compatible with the bottle measure", (serving) => {
    expect(judgeBill(read([[`Guinness ${serving}`, 5.2]]), 5.2, "Guinness", "bottle").result).toBe("match");
  });

  it.each([
    ["Pint of lager", "Lager pint", "pint", "half"],
    ["Half of lager", "Lager half pint", "half", "pint"],
    ["Lager 1/2 pint", "1/2 lager", "half", "pint"],
    ["½ pint lager", "Lager ½", "half", "pint"],
    ["Single Jameson", "Jameson single", "single", "double"],
    ["Double Jameson", "Jameson double", "double", "single"],
    ["Double Grey Goose", "Grey Goose double", "double", "single"],
    ["Single Jack Daniel's", "Jack Daniel's single", "single", "double"],
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

  it.each([
    "Half-pint Guinness",
    "1/2-pint Guinness",
    "½-pint Guinness",
    "Guinness half-pint",
    "Guinness 1/2-pint",
    "Guinness ½-pint",
  ])("checks the complete half-pint serving in %s on either side", (served) => {
    const servedBill = read([[served, 2.6]]);
    const plainBill = read([["Guinness", 2.6]]);
    expect(judgeBill(servedBill, 2.6, "Guinness", "half").result).toBe("match");
    expect(judgeBill(plainBill, 2.6, served, "half").result).toBe("match");
    expect(judgeBill(servedBill, 2.6, served, "half").result).toBe("match");
    expect(judgeBill(servedBill, 2.6, "Guinness half pint", "half").result).toBe("match");
    expect(judgeBill(servedBill, 2.6, "Guinness", "pint").result).toBe("mismatch");
    expect(judgeBill(plainBill, 2.6, served, "pint").result).toBe("mismatch");
    expect(judgeBill(servedBill, 2.6, served, "pint").result).toBe("mismatch");
    expect(judgeBill(read([["Pint Guinness", 2.6]]), 2.6, served).result).toBe("mismatch");
    expect(judgeBill(servedBill, 2.6, "Guinness pint").result).toBe("mismatch");
  });

  it.each([
    ["Half Carlsberg", "Carlsberg", "half", "pint"],
    ["Pint Carlsberg", "Carlsberg", "pint", "half"],
    ["Bottle Carlsberg", "Carlsberg", "bottle", "pint"],
    ["Half Foster's", "Foster's", "half", "pint"],
    ["Half Heineken", "Heineken", "half", "pint"],
    ["Pint Heineken", "Heineken", "pint", "half"],
    ["Pint London Pride", "London Pride", "pint", "half"],
    ["Half London Pride", "London Pride", "half", "pint"],
    ["Bottle Heineken", "Heineken", "bottle", "pint"],
    ["Half Heineken lager", "Heineken lager", "half", "pint"],
    ["London Pride pint", "London Pride", "pint", "half"],
  ] as const)("checks canonical beer servings in %s against the submitted measure", (served, product, measure, different) => {
    expect(judgeBill(read([[served, 2.6]]), 2.6, served, different).result).toBe("mismatch");
    expect(judgeBill(read([[served, 2.6]]), 2.6, served, measure).result).toBe("match");
    expect(judgeBill(read([[served, 2.6]]), 2.6, product, different).result).toBe("mismatch");
    expect(judgeBill(read([[served, 2.6]]), 2.6, product, measure).result).toBe("match");
    expect(judgeBill(read([[product, 2.6]]), 2.6, served, different).result).toBe("mismatch");
    expect(judgeBill(read([[product, 2.6]]), 2.6, served, measure).result).toBe("match");
    expect(judgeBill(read([[product, 2.6]]), 2.6, served).result).toBe("match");
    expect(judgeBill(read([[served, 2.6]]), 2.6, product).result).toBe("match");
  });

  it.each([
    ["Double Single Malt Whisky", "Single Malt Whisky", "Malt Whisky", "double", "single"],
    ["Single Double IPA", "Double IPA", "IPA", "single", "double"],
    ["Half Half Moon IPA", "Half Moon IPA", "Moon IPA", "half", "pint"],
    ["Pint Double IPA", "Double IPA", "IPA", "pint", "half"],
  ] as const)("separates the outer serving from the product in %s", (served, product, shortened, measure, different) => {
    expect(judgeBill(read([[served, 5.2]]), 5.2, served, different).result).toBe("mismatch");
    expect(judgeBill(read([[served, 5.2]]), 5.2, served, measure).result).toBe("match");
    expect(judgeBill(read([[served, 5.2]]), 5.2, product, different).result).toBe("mismatch");
    expect(judgeBill(read([[served, 5.2]]), 5.2, product, measure).result).toBe("match");
    expect(judgeBill(read([[product, 5.2]]), 5.2, served, different).result).toBe("mismatch");
    expect(judgeBill(read([[product, 5.2]]), 5.2, served, measure).result).toBe("match");
    expect(judgeBill(read([[product, 5.2]]), 5.2, served).result).toBe("match");
    expect(judgeBill(read([[shortened, 5.2]]), 5.2, served, measure).result).toBe("unreadable");
    expect(judgeBill(read([[served, 5.2]]), 5.2, shortened, measure).result).toBe("unreadable");
  });

  it.each([
    ["Merlot 175ml", "250ml", "Merlot"],
    ["250 ml Merlot", "175ml", "Merlot"],
    ["Merlot 125 ml", "250ml", "Merlot"],
    ["Guinness pint", "half", "Guinness"],
    ["Half pint Guinness", "pint", "Guinness"],
    ["Guinness 1/2 pint", "pint", "Guinness"],
    ["Guinness ½", "pint", "Guinness"],
    ["Single Jameson", "double", "Jameson"],
    ["Double Jameson", "single", "Jameson"],
    ["Bottle of Merlot", "175ml", "Merlot"],
  ] as const)("rejects conflicting submitted servings in %s with measure %s", (drink, measure, name) => {
    const lines = read([[name, 5.2]]);
    expect(judgeBill(lines, 5.2, drink, measure)).toEqual({
      result: "mismatch",
      lines: lines.lines,
    });
    expect(judgeBill(read([[drink, 5.2]]), 5.2, drink, measure).result).toBe("mismatch");
  });

  it.each([
    ["Merlot 175ml", "175ml", "Merlot"],
    ["Guinness half pint", "half", "Guinness"],
    ["Double Jameson", "double", "Jameson"],
  ] as const)("accepts consistent servings in %s when the bill omits the serving", (drink, measure, name) => {
    const lines = read([[name, 5.2]]);
    expect(judgeBill(lines, 5.2, drink, measure).result).toBe("match");
    expect(judgeBill(lines, 5.2, drink).result).toBe("match");
  });

  it.each([
    ["Pint Halfway House Pale", "pint", "half"],
    ["Half Halfway House Pale", "half", "pint"],
    ["Bottle Halfway House Pale", "bottle", "pint"],
    ["Single Halfway House Pale", "single", "double"],
    ["Double Halfway House Pale", "double", "single"],
  ] as const)("checks outer servings on an uncatalogued product in %s", (served, measure, different) => {
    const product = "Halfway House Pale";
    expect(judgeBill(read([[served, 5.2]]), 5.2, product, measure).result).toBe("match");
    expect(judgeBill(read([[product, 5.2]]), 5.2, served, measure).result).toBe("match");
    expect(judgeBill(read([[served, 5.2]]), 5.2, product, different).result).toBe("mismatch");
    expect(judgeBill(read([[product, 5.2]]), 5.2, served, different).result).toBe("mismatch");
    expect(judgeBill(read([[served, 5.2]]), 5.2, served, different).result).toBe("mismatch");
    expect(judgeBill(read([[served, 5.2]]), 5.2, `${different} ${product}`).result).toBe("mismatch");
    expect(judgeBill(read([[served, 5.2]]), 5.2, `${product} ${measure}`, measure).result).toBe("match");
    expect(judgeBill(read([[`${product} ${measure}`, 5.2]]), 5.2, served, measure).result).toBe("match");
    expect(judgeBill(read([[served, 5.2]]), 5.2, product).result).toBe("match");
    expect(judgeBill(read([[product, 5.2]]), 5.2, served).result).toBe("match");
    expect(judgeBill(read([[served, 5.2]]), 5.3, product, measure).result).toBe("mismatch");
  });

  it.each([
    "Double Chocolate Stout",
    "Single Hop Pale Ale",
    "Bottle Conditioned Ale",
    "Half Baked Pale Ale",
    "Pint Sized Pale Ale",
  ])("preserves a shared product prefix in %s", (drink) => {
    const lines = read([[drink, 5.2]]);
    expect(judgeBill(lines, 5.2, drink, "pint")).toEqual({ result: "match", lines: lines.lines });
    expect(judgeBill(lines, 5.2, drink).result).toBe("match");
    expect(judgeBill(lines, 5.3, drink, "pint").result).toBe("mismatch");
    expect(judgeBill(read([[`${drink} pint`, 5.2]]), 5.2, drink, "pint").result).toBe("match");
    expect(judgeBill(lines, 5.2, `${drink} pint`, "pint").result).toBe("match");
  });

  it.each(["Double IPA", "Single Malt Whisky", "Half Moon IPA", "Bottle Rocket IPA", "Halfway House Pale"])(
    "preserves the product words in %s on both sides of the comparison",
    (drink) => {
      const shortened = drink.split(" ").slice(1).join(" ");
      expect(judgeBill(read([[drink, 5.2]]), 5.2, drink, "pint").result).toBe("match");
      expect(judgeBill(read([[`${drink} pint`, 5.2]]), 5.2, drink, "pint").result).toBe("match");
      expect(judgeBill(read([[`Pint ${drink}`, 5.2]]), 5.2, drink, "pint").result).toBe("match");
      expect(judgeBill(read([[drink, 5.2]]), 5.2, `Pint ${drink}`, "pint").result).toBe("match");
      expect(judgeBill(read([[shortened, 5.2]]), 5.2, drink, "pint").result).toBe("unreadable");
      expect(judgeBill(read([[drink, 5.2]]), 5.2, shortened, "pint").result).toBe("unreadable");
    },
  );

  it.each(["match", "mismatch"] as const)("judges the numeric beer alias before redacting %s evidence", (result) => {
    const parsed = parseBillReadAnswer(bill([
      { name: "1664", price_gbp: 5.2 },
      { name: "Visa **** 4921 1234", price_gbp: 5.2 },
    ]));
    const verdict = judgeBill(parsed, result === "match" ? 5.2 : 6.2, "1664", "pint");
    expect(verdict).toEqual({
      result,
      lines: result === "match"
        ? [{ name: "Item", priceGbp: 5.2 }]
        : [{ name: "Item", priceGbp: 5.2 }, { name: "Visa ****", priceGbp: 5.2 }],
    });
    expect(judgeBill(parseBillReadAnswer(bill([{ name: "1664", price_gbp: 5.2 }])),
      result === "match" ? 5.2 : 6.2, "1664", "pint")).toEqual({
      result,
      lines: [{ name: "Item", priceGbp: 5.2 }],
    });
    expect(judgeBill(parsed, 5.2, "1234", "pint").result).toBe("unreadable");
  });

  it.each(["match", "mismatch"] as const)("compares numeric product names before redacting %s evidence", (result) => {
    const parsed = parseBillReadAnswer(bill([
      { name: "Kronenbourg 1664", price_gbp: 5.2 },
      { name: "Visa **** 4921 1234", price_gbp: 5.2 },
    ]));
    const verdict = judgeBill(parsed, result === "match" ? 5.2 : 6.2, "Kronenbourg 1664", "pint");
    expect(verdict.result).toBe(result);
    expect(verdict.lines[0]).toEqual({ name: "Kronenbourg", priceGbp: 5.2 });
    expect(verdict.lines).toHaveLength(result === "match" ? 1 : 2);
    for (const line of verdict.lines) expect(line.name).not.toMatch(/\d{4}/);
    expect(judgeBill(parsed, 5.2, "Kronenbourg 1234", "pint").result).toBe("unreadable");
    expect(judgeBill(parsed, 5.2, "Kronenbourg", "pint").result).toBe("unreadable");
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
