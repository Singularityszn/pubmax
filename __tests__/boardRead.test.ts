// The board reader's one parser (lib/boardRead.ts): a model answer becomes
// proposals only where a price write could hold the row, and a food line is
// kept out rather than sent.

import { describe, expect, it } from "vitest";

import {
  BOARD_READ_MAX_ROWS,
  boardPriceGbp,
  parseBoardReadAnswer,
} from "@/lib/boardRead";

const drink = (over: Record<string, unknown> = {}) => ({
  name: "Guinness",
  kind: "drink",
  category: "beer",
  measure: "pint",
  measureLabel: "",
  pricePence: 620,
  confidence: "clear",
  ...over,
});

describe("parseBoardReadAnswer", () => {
  it("keeps a readable drink row with its measure and price in pence", () => {
    const read = parseBoardReadAnswer({ rows: [drink()] });
    expect(read).toEqual({
      proposals: [{
        id: "row-1",
        name: "Guinness",
        category: "beer",
        measure: "pint",
        measureLabel: "",
        pricePence: 620,
        confidence: "clear",
      }],
      keptOut: [],
    });
  });

  it("drops a row with no price, a fractional price or a price outside the envelope", () => {
    const read = parseBoardReadAnswer({ rows: [
      drink({ pricePence: undefined }),
      drink({ pricePence: "620" }),
      drink({ pricePence: 6.2 }),
      drink({ pricePence: 50 }),
      drink({ pricePence: 4000 }),
    ] });
    expect(read.proposals).toEqual([]);
  });

  it("drops a row whose measure or category is not on the closed set", () => {
    const read = parseBoardReadAnswer({ rows: [
      drink({ measure: "schooner" }),
      drink({ measure: "" }),
      drink({ category: "ale" }),
      drink({ name: "Half of Camden", measure: "half" }),
    ] });
    expect(read.proposals.map((row) => [row.name, row.measure])).toEqual([["Half of Camden", "half"]]);
  });

  it("keeps a food line out and never offers it as a drink", () => {
    const read = parseBoardReadAnswer({ rows: [
      { name: "Scotch egg", kind: "food", category: "other", measure: "other", pricePence: 450 },
      drink(),
    ] });
    expect(read.keptOut).toEqual([{ id: "row-1", name: "Scotch egg", pricePence: 450 }]);
    expect(read.proposals.map((row) => row.id)).toEqual(["row-2"]);
  });

  it("carries the free label only on an other measure, and reads an unknown confidence as unsure", () => {
    const read = parseBoardReadAnswer({ rows: [
      drink({ category: "wine", measure: "other", measureLabel: " 175ml <glass> ", confidence: "certain" }),
      drink({ measureLabel: "a pint" }),
    ] });
    expect(read.proposals[0]).toMatchObject({ measure: "other", measureLabel: "175ml glass", confidence: "unsure" });
    expect(read.proposals[1]).toMatchObject({ measure: "pint", measureLabel: "" });
  });

  it("reads a malformed answer as an empty read and caps a long board", () => {
    expect(parseBoardReadAnswer(null)).toEqual({ proposals: [], keptOut: [] });
    expect(parseBoardReadAnswer({ rows: "Guinness £6.20" })).toEqual({ proposals: [], keptOut: [] });
    const long = parseBoardReadAnswer({ rows: Array.from({ length: 40 }, (_, i) => drink({ name: `Beer ${i}` })) });
    expect(long.proposals).toHaveLength(BOARD_READ_MAX_ROWS);
  });

  it("prints pence as the pounds string the price write takes", () => {
    expect(boardPriceGbp(480)).toBe("4.80");
    expect(boardPriceGbp(1205)).toBe("12.05");
  });
});
