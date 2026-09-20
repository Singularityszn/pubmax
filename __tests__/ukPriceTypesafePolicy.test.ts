import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DRAUGHT_PINT_PUBLISH_THRESHOLD,
  DRAUGHT_PINT_REVIEW_THRESHOLD,
  decisionFromJudgment,
  type UkPriceJudgmentProbabilities,
} from "@/lib/harvest/ukPriceJudgmentPolicy";

const ROOT = process.cwd();
const cases = JSON.parse(
  readFileSync(join(ROOT, "__tests__/fixtures/typesafe/pint-price-cases.json"), "utf8"),
) as Array<{
  id: string;
  priceGbp: number;
  expectPublish: boolean;
  expectCategory?: string;
  expectMisfire?: string;
}>;
const PROB_PATH = join(ROOT, "__tests__/fixtures/typesafe/pint-price-judgment-probabilities.json");

type RecordedFile = {
  cases: Record<string, UkPriceJudgmentProbabilities>;
};

function loadRecorded(): RecordedFile {
  return JSON.parse(readFileSync(PROB_PATH, "utf8")) as RecordedFile;
}

describe("pint price judgment thresholds", () => {
  it("documents thresholds chosen from the recorded fixture file", () => {
    expect(DRAUGHT_PINT_PUBLISH_THRESHOLD).toBeGreaterThan(0);
    expect(DRAUGHT_PINT_REVIEW_THRESHOLD).toBeLessThan(DRAUGHT_PINT_PUBLISH_THRESHOLD);
    expect(existsSyncProbFile()).toBe(true);
  });

  it("matches fixture expectations when probabilities are replayed", () => {
    const recorded = loadRecorded();
    for (const row of cases) {
      const probs = recorded.cases[row.id];
      expect(probs, row.id).toBeDefined();
      const decision = decisionFromJudgment(probs, row.priceGbp);
      if (row.expectPublish) {
        expect(decision.outcome, row.id).toBe("publish");
        if (row.expectCategory) expect(decision.category, row.id).toBe(row.expectCategory);
      } else {
        expect(decision.outcome, row.id).not.toBe("publish");
        if (row.expectMisfire === "draught_pint" && decision.outcome === "publish") {
          expect(decision.category, row.id).not.toBe("beer");
        }
      }
    }
  });
});

function existsSyncProbFile(): boolean {
  try {
    readFileSync(PROB_PATH);
    return true;
  } catch {
    return false;
  }
}
