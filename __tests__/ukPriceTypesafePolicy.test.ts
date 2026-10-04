import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";
import {
  DRINK_CATEGORY_JUDGMENT_OPTIONS,
  WHAT_IS_PRICED_OPTIONS,
  DRAUGHT_PINT_PUBLISH_THRESHOLD,
  DRAUGHT_PINT_REVIEW_THRESHOLD,
  decisionFromJudgment,
  type UkPriceJudgmentProbabilities,
} from "@/lib/harvest/ukPriceJudgmentPolicy";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();
const cases = JSON.parse(
  readFileSync(join(ROOT, "__tests__/fixtures/typesafe/pint-price-cases.json"), "utf8"),
) as Array<{
  id: string;
  priceGbp: number;
  expectPublish: boolean;
  expectCategory?: string;
  expectMisfire?: string;
  snippet: string;
}>;
const PROB_PATH = join(ROOT, "__tests__/fixtures/typesafe/pint-price-judgment-probabilities.json");

type RecordedFile = {
  cases: Record<string, UkPriceJudgmentProbabilities>;
};

function loadRecorded(): RecordedFile {
  return JSON.parse(readFileSync(PROB_PATH, "utf8")) as RecordedFile;
}

describe("pint price judgment thresholds", () => {
  // A threshold test that passes for any pair of numbers proves nothing. This
  // one replays the committed fixture run and fails if either threshold moves
  // far enough to change an outcome, in EITHER direction.
  it("proves the thresholds are the ones the fixture run chose", () => {
    const recorded = loadRecorded();
    const draughtProbs = cases
      .map((row) => recorded.cases[row.id]?.whatIsPriced.draught_pint ?? 0)
      .sort((a, b) => a - b);

    // The publish threshold sits strictly between the highest draught figure the
    // fixtures refuse to publish and the lowest they do.
    const published = cases
      .filter((row) => row.expectPublish && row.expectCategory === "beer")
      .map((row) => defined(recorded.cases[row.id]).whatIsPriced.draught_pint);
    const refused = cases
      .filter((row) => !row.expectPublish)
      .map((row) => defined(recorded.cases[row.id]).whatIsPriced.draught_pint);

    expect(Math.min(...published)).toBeGreaterThanOrEqual(DRAUGHT_PINT_PUBLISH_THRESHOLD);
    expect(Math.max(...refused)).toBeLessThan(DRAUGHT_PINT_PUBLISH_THRESHOLD);
    expect(DRAUGHT_PINT_REVIEW_THRESHOLD).toBeLessThan(DRAUGHT_PINT_PUBLISH_THRESHOLD);
    expect(draughtProbs.length).toBe(cases.length);
  });

  // The band is only real if something can land in it.
  it("routes a draught figure between the two thresholds to review", () => {
    const between = (DRAUGHT_PINT_PUBLISH_THRESHOLD + DRAUGHT_PINT_REVIEW_THRESHOLD) / 2;
    const probs = {
      whatIsPriced: Object.fromEntries(
        WHAT_IS_PRICED_OPTIONS.map((key) => [key, key === "draught_pint" ? between : 0]),
      ),
      isPromotionalPrice: 0,
      drinkCategory: Object.fromEntries(
        DRINK_CATEGORY_JUDGMENT_OPTIONS.map((key) => [key, key === "beer" ? 1 : 0]),
      ),
    } as UkPriceJudgmentProbabilities;
    expect(decisionFromJudgment(probs, 6.2).outcome).toBe("review");
  });

  // No branch may publish on argmax alone. An eight-way choice whose winner is
  // barely ahead of the field is the model saying it does not know.
  it("refuses every branch that has not cleared the publish floor", () => {
    for (const winner of WHAT_IS_PRICED_OPTIONS) {
      const probs = {
        whatIsPriced: Object.fromEntries(
          WHAT_IS_PRICED_OPTIONS.map((key) => [key, key === winner ? 0.13 : 0.11]),
        ),
        isPromotionalPrice: 0,
        drinkCategory: Object.fromEntries(
          DRINK_CATEGORY_JUDGMENT_OPTIONS.map((key) => [key, key === "beer" ? 1 : 0]),
        ),
      } as UkPriceJudgmentProbabilities;
      expect(decisionFromJudgment(probs, 6.2).outcome, winner).not.toBe("publish");
    }
  });

  // A bottle is not a pint however sure the model is, and it must never fall
  // through to the beer lane on an unclear drink category.
  it("never publishes a bottle or can as a pint", () => {
    const probs = {
      whatIsPriced: Object.fromEntries(
        WHAT_IS_PRICED_OPTIONS.map((key) => [key, key === "bottle_or_can" ? 1 : 0]),
      ),
      isPromotionalPrice: 0,
      drinkCategory: Object.fromEntries(
        DRINK_CATEGORY_JUDGMENT_OPTIONS.map((key) => [key, key === "unclear" ? 1 : 0]),
      ),
    } as UkPriceJudgmentProbabilities;
    const decision = decisionFromJudgment(probs, 6.2);
    expect(decision.outcome).toBe("reject");
    expect(decision.drop).toBe("bottled-measure-not-a-pint");
  });

  it("matches fixture expectations when probabilities are replayed", () => {
    const recorded = loadRecorded();
    for (const row of cases) {
      const probs = recorded.cases[row.id];
      expect(probs, row.id).toBeDefined();
      const decision = decisionFromJudgment(defined(probs), row.priceGbp);
      if (row.expectPublish) {
        expect(decision.outcome, row.id).toBe("publish");
        if (row.expectCategory) expect(decision.category, row.id).toBe(row.expectCategory);
      } else {
        expect(decision.outcome, row.id).not.toBe("publish");
      }
    }
  });

  // The keyless CLI is the path a run without a key takes, so the two recorded
  // misfires have to die there too -- a judged-only proof would leave them live
  // on every keyless harvest.
  it("drops both recorded misfires on the keyless regex path too", () => {
    const misfires = cases.filter((row) => row.expectMisfire);
    expect(misfires.length).toBeGreaterThan(0);
    for (const row of misfires) {
      const reading = readVenueDrinkPrices(`<html><body><p>${row.snippet}</p></body></html>`);
      expect(reading.kept, row.id).toEqual([]);
      expect(reading.drops.length, row.id).toBeGreaterThan(0);
    }
  });
});
