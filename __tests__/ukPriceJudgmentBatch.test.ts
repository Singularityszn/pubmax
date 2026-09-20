import { describe, expect, it } from "vitest";

import {
  UK_PRICE_JUDGMENT_TOKEN_BUDGET,
  batchUkPriceCandidates,
  estimateUkPriceJudgmentBatchTokens,
  ukPriceJudgmentBatchSize,
} from "@/lib/harvest/ukPriceJudgmentBatch";

const ctx = { pubName: "The Crown", pageUrl: "https://example.com/drinks" };

function candidate(snippetLength: number) {
  const snippet = "x".repeat(snippetLength);
  return { snippet, priceText: "£6.20" };
}

describe("ukPriceJudgmentBatch sizing", () => {
  it("fits about eighty 250-char snippets in one batch under the token budget", () => {
    const rows = Array.from({ length: 80 }, () => candidate(250));
    expect(estimateUkPriceJudgmentBatchTokens(ctx, rows)).toBeLessThanOrEqual(
      UK_PRICE_JUDGMENT_TOKEN_BUDGET,
    );
    expect(ukPriceJudgmentBatchSize(ctx, rows)).toBe(80);
  });

  it("splits when candidate snippets overflow the budget", () => {
    const rows = Array.from({ length: 40 }, () => candidate(6_500));
    const batches = batchUkPriceCandidates(ctx, rows);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(40);
    for (const batch of batches) {
      expect(estimateUkPriceJudgmentBatchTokens(ctx, batch)).toBeLessThanOrEqual(
        UK_PRICE_JUDGMENT_TOKEN_BUDGET,
      );
    }
  });
});
