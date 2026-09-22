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
  it.each(["Remember when pints cost £2 at The Roebuck in London?", "I paid £3 at The Roebuck in Camden back in 2010.", "I paid £3 for a pint at The Roebuck in Southwark in 2010."])("refuses retrospective copy: %s", (body) => {
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

  it.each([
    "I paid £12 for food and a pint was £5.50 at The Roebuck in Southwark.",
    "At The Roebuck in Southwark, I paid £12 for a burger; a pint was £5.50.",
  ])("does not turn a meal price into beer: %s", (body) => {
    const rows = extractRedditPriceCandidates({ body, permalink: "", observedAt: "2026-09-20T12:00:00Z", author: "fixture" });
    expect(rows.map((row) => row.priceGbp)).toEqual([5.5]);
  });

  it.each([
    "I paid £12 for food at The Roebuck in Southwark. I had a pint too.",
    "I paid £12 for a burger and pint at The Roebuck in Southwark.",
  ])("refuses food or combined meal context: %s", (body) => {
    expect(extractRedditPriceCandidates({ body, permalink: "", observedAt: "2026-09-20T12:00:00Z", author: "fixture" })).toEqual([]);
  });

  it.each([
    "Paid £100 for a pint at The Roebuck in Southwark.",
    "Paid £5.555 for a pint at The Roebuck in Southwark.",
    "Paid £5,50 for a pint at The Roebuck in Southwark.",
    "A pint was £5,50 at The Roebuck in Southwark.",
  ])("does not truncate malformed or out-of-range amounts: %s", (body) => {
    expect(extractRedditPriceCandidates({ body, permalink: "", observedAt: "2026-09-20T12:00:00Z", author: "fixture" })).toEqual([]);
  });

  it("does not attach prices from different pubs to the first pub", () => {
    const rows = extractRedditPriceCandidates({
      body: "Paid £5.50 for a pint at The Roebuck in Southwark. Paid £6.20 for a pint at The Devonshire in Westminster.",
      permalink: "", observedAt: "2026-09-20T12:00:00Z", author: "fixture",
    });
    expect(rows.map((row) => [row.pubNameHint, row.areaHint, row.priceGbp])).toEqual([
      ["The Roebuck", "Southwark", 5.5], ["The Devonshire", "Westminster", 6.2],
    ]);
  });

  it.each([
    ["Paid £5.50 for a Guinness at The Roebuck in Southwark.", "Guinness", undefined],
    ["Paid £5.50 for a pint of Guinness at The Roebuck in Southwark.", "pint of Guinness", "pint"],
    ["Paid £3 for a half pint of Guinness at The Roebuck in Southwark.", "half pint of Guinness", "half"],
  ])("preserves stated drink and only explicit measure: %s", (body, drinkText, measure) => {
    const [row] = extractRedditPriceCandidates({ body, permalink: "", observedAt: "2026-09-20T12:00:00Z", author: "fixture" });
    expect(row?.drinkText).toBe(drinkText);
    expect(row?.measure).toBe(measure);
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
