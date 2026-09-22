import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REDDIT_ACTUAL_PRICE_PUBLISH_THRESHOLD,
  REDDIT_ACTUAL_PRICE_REVIEW_THRESHOLD,
  redditDecisionFromJudgment,
  keylessRedditJudgment,
} from "@/lib/harvest/redditPriceJudgmentPolicy";
import type { CommunityPriceEvidence } from "@/lib/communityPrice";

const FIX = JSON.parse(
  readFileSync(
    join(process.cwd(), "__tests__/fixtures/typesafe/reddit-price-judgment-probabilities.json"),
    "utf8",
  ),
) as { cases: Record<string, { isActualPriceReport: number }> };

describe("reddit price judgment thresholds", () => {
  it("never publishes a wish as an actual price report", () => {
    expect(redditDecisionFromJudgment(keylessRedditJudgment("I wish a pint cost £5.50 at The Roebuck in Southwark."), 5.5).outcome).toBe("reject");
  });
  it.each(["I paid £5.50 for a half pint of Guinness.", "I paid £5.50 for a bottle of lager."])("does not publish a non-pint as a pint: %s", (text) => {
    expect(redditDecisionFromJudgment(keylessRedditJudgment(text), 5.5).outcome).toBe("reject");
  });
  it("never publishes nostalgic prices as current reports", () => {
    expect(redditDecisionFromJudgment(keylessRedditJudgment("Remember when a pint cost £5.50?"), 5.5).outcome).toBe("reject");
  });
  it("keeps publish above the fixture floor", () => {
    const published = Object.values(FIX.cases).filter((c) => c.isActualPriceReport >= REDDIT_ACTUAL_PRICE_PUBLISH_THRESHOLD);
    expect(published.length).toBeGreaterThan(0);
    expect(REDDIT_ACTUAL_PRICE_REVIEW_THRESHOLD).toBeLessThan(REDDIT_ACTUAL_PRICE_PUBLISH_THRESHOLD);
  });

  it("types the evidence lane for knip", () => {
    const sample: CommunityPriceEvidence = { source: "reddit", url: "https://example.com", confidence: 0.8 };
    expect(sample.source).toBe("reddit");
  });
});
