import { describe, expect, it } from "vitest";

import {
  calculateCrawlCost,
  CRAWL_LIMITS,
  formatPence,
  parsePriceToPence,
  parseWholeNumber,
} from "@/lib/crawlCostCalculator";

// Tactic 41 in docs/growth/BACKLINK_PLAYBOOK.md: a free tool earns links only
// while its answers hold, so it is tested on normal and on unusual inputs.

describe("calculateCrawlCost, normal inputs", () => {
  it("prices a four-person, five-pub crawl in whole pence", () => {
    const result = calculateCrawlCost({ people: 4, stops: 5, drinksPerStop: 1, pricePence: 585 });
    expect(result).toMatchObject({
      ok: true,
      drinksEach: 5,
      drinksTotal: 20,
      totalPence: 11_700,
      perPersonPence: 2_925,
      perStopPence: 2_340,
      roundPence: 2_340,
      roundsTotal: 5,
      rounds: { fewest: 1, buyingOneMore: 1, gapPence: 2_340, roundsToEven: 3 },
    });
  });

  it("says rounds are even when the rounds divide by the group", () => {
    const result = calculateCrawlCost({ people: 3, stops: 3, drinksPerStop: 2, pricePence: 600 });
    expect(result.ok && result.rounds).toEqual({ fewest: 2, buyingOneMore: 0, gapPence: 0, roundsToEven: 0 });
  });

  it("keeps the total equal to the per-person cost times the group", () => {
    for (const people of [1, 2, 7, 40]) {
      const result = calculateCrawlCost({ people, stops: 6, drinksPerStop: 2, pricePence: 733 });
      if (!result.ok) throw new Error(result.message);
      expect(result.totalPence).toBe(result.perPersonPence * people);
      expect(result.totalPence).toBe(result.perStopPence * 6);
    }
  });
});

describe("calculateCrawlCost, unusual inputs", () => {
  it("handles one person drinking alone: every round is theirs", () => {
    const result = calculateCrawlCost({ people: 1, stops: 3, drinksPerStop: 1, pricePence: 500 });
    expect(result.ok && result.rounds).toEqual({ fewest: 3, buyingOneMore: 0, gapPence: 0, roundsToEven: 0 });
  });

  it("handles a group bigger than the number of rounds", () => {
    const result = calculateCrawlCost({ people: 10, stops: 2, drinksPerStop: 1, pricePence: 500 });
    expect(result.ok && result.rounds).toEqual({ fewest: 0, buyingOneMore: 2, gapPence: 5_000, roundsToEven: 8 });
  });

  it("accepts every limit itself", () => {
    const low = calculateCrawlCost({
      people: CRAWL_LIMITS.people.min,
      stops: CRAWL_LIMITS.stops.min,
      drinksPerStop: CRAWL_LIMITS.drinksPerStop.min,
      pricePence: CRAWL_LIMITS.pricePence.min,
    });
    const high = calculateCrawlCost({
      people: CRAWL_LIMITS.people.max,
      stops: CRAWL_LIMITS.stops.max,
      drinksPerStop: CRAWL_LIMITS.drinksPerStop.max,
      pricePence: CRAWL_LIMITS.pricePence.max,
    });
    expect(low.ok).toBe(true);
    expect(high.ok && high.totalPence).toBe(40 * 20 * 5 * 5_000);
    expect(high.ok && Number.isSafeInteger(high.totalPence)).toBe(true);
  });

  it.each([
    ["people", { people: 0 }],
    ["people", { people: 41 }],
    ["people", { people: 2.5 }],
    ["stops", { stops: Number.NaN }],
    ["drinksPerStop", { drinksPerStop: -1 }],
    ["pricePence", { pricePence: 49 }],
    ["pricePence", { pricePence: Number.POSITIVE_INFINITY }],
  ] as const)("refuses a bad %s and names the field", (field, patch) => {
    const result = calculateCrawlCost({ people: 4, stops: 4, drinksPerStop: 1, pricePence: 600, ...patch });
    expect(result).toMatchObject({ ok: false, field });
    expect(result.ok ? "" : result.message).toMatch(/\.$/);
  });
});

describe("parsing what a reader types", () => {
  it.each([
    ["5.85", 585],
    ["£5.85", 585],
    [" £ 6 ", 600],
    ["6.5", 650],
    ["0.50", 50],
  ])("reads %j as %i pence", (raw, pence) => {
    expect(parsePriceToPence(raw)).toBe(pence);
  });

  it.each(["", "abc", "5.855", "-5", "5,85", "1e3", "£", "1000"])("refuses %j", (raw) => {
    expect(parsePriceToPence(raw)).toBeNaN();
  });

  it("reads whole numbers and refuses the rest", () => {
    expect(parseWholeNumber("12")).toBe(12);
    expect(parseWholeNumber(" 4 ")).toBe(4);
    expect(parseWholeNumber("4.5")).toBeNaN();
    expect(parseWholeNumber("")).toBeNaN();
    expect(parseWholeNumber("-2")).toBeNaN();
  });

  it("formats pence as pounds with two decimals", () => {
    expect(formatPence(11_700)).toBe("£117.00");
    expect(formatPence(50)).toBe("£0.50");
  });
});
