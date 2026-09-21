import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  commentsFromRedditThreadPayload,
  extractRedditPriceCandidates,
  redditObservedAt,
} from "@/lib/harvest/redditPriceExtract";
import { keylessRedditJudgment, redditDecisionFromJudgment } from "@/lib/harvest/redditPriceJudgmentPolicy";

const FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), "__tests__/fixtures/reddit/london_pint_thread.json"), "utf8"),
);

describe("reddit price extractor fixture thread", () => {
  it("pulls paid-or-saw candidates and drops pure hypotheticals", () => {
    const comments = commentsFromRedditThreadPayload(FIXTURE);
    expect(comments.length).toBe(3);
    const candidates = comments.flatMap((c) =>
      extractRedditPriceCandidates({
        body: c.body ?? "",
        permalink: c.permalink ?? "https://www.reddit.com/r/london/comments/abc/",
        observedAt: redditObservedAt(c.created_utc ?? 0),
        author: c.author ?? "anon",
      }),
    );
    expect(candidates.map((c) => c.priceGbp)).toEqual([5.5, 6.2]);
    for (const row of candidates) {
      const decision = redditDecisionFromJudgment(keylessRedditJudgment(row.snippet), row.priceGbp);
      expect(decision.outcome).toBe("publish");
      expect(decision.drinkCategory).toBe("beer");
    }
  });
});
