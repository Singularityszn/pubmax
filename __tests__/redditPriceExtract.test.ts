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
  it.each(["Remember when pints cost £2 at The Roebuck in London?", "I paid £3 at The Roebuck in Camden back in 2010."])("refuses retrospective copy: %s", (body) => {
    expect(extractRedditPriceCandidates({
      body,
      permalink: "https://www.reddit.com/r/london/comments/1abc234/pints/mabc234/",
      observedAt: "2026-09-20T12:00:00.000Z",
      author: "fixture",
    })).toEqual([]);
  });

  it.each(["", "invalid", "1970-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"])("refuses missing or unusable observation date: %s", (observedAt) => {
    expect(extractRedditPriceCandidates({
      body: "I paid £5.50 for a pint at The Roebuck in Camden.",
      permalink: "https://www.reddit.com/r/london/comments/1abc234/pints/mabc234/",
      observedAt,
      author: "fixture",
    })).toEqual([]);
  });

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
