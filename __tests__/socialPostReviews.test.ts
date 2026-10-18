import { describe, expect, it } from "vitest";

import {
  formatSocialReviewRating,
  parseSocialReviewRating,
  rankSocialReviews,
  socialReviewStars,
} from "@/lib/socialPostReviews";
import { createMemorySocialPostReviewStore } from "@/lib/socialPostReviewStore";
import { parseSocialCreateSubmission } from "@/lib/socialPostSubmission";

const scored = {
  kind: "standard",
  visibility: "friends",
  body: "Proper pint, loud jukebox",
  venueId: "venue-beehive",
  commentPolicy: "open",
};

describe("Social review scores", () => {
  it("keeps the half-step scale from 1 to 5 and nothing else", () => {
    expect([1, 1.5, 3, 4.5, 5].map(parseSocialReviewRating)).toEqual([1, 1.5, 3, 4.5, 5]);
    expect([0, 0.5, 4.25, 5.5, Number.NaN, "4", null].map(parseSocialReviewRating)).toEqual(
      [null, null, null, null, null, null, null],
    );
  });

  it("prints a whole score bare and a half score with its decimal", () => {
    expect(formatSocialReviewRating(4)).toBe("4");
    expect(formatSocialReviewRating(3.5)).toBe("3.5");
    expect(socialReviewStars(3.5)).toEqual({ full: 3, half: true, empty: 1 });
    expect(socialReviewStars(5)).toEqual({ full: 5, half: false, empty: 0 });
  });

  it("ranks the newest score per pub, best first, newer score breaking a tie", () => {
    const ranked = rankSocialReviews([
      { postId: "p1", venueId: "beehive", venueName: null, rating: 3, reviewedAt: "2026-10-01T00:00:00Z" },
      { postId: "p2", venueId: "beehive", venueName: null, rating: 5, reviewedAt: "2026-10-08T00:00:00Z" },
      { postId: "p3", venueId: "sol", venueName: null, rating: 4.5, reviewedAt: "2026-10-02T00:00:00Z" },
      { postId: "p4", venueId: "roses", venueName: null, rating: 4.5, reviewedAt: "2026-10-05T00:00:00Z" },
    ]);
    expect(ranked.map((entry) => `${entry.venueId}:${entry.rating}`)).toEqual(["beehive:5", "roses:4.5", "sol:4.5"]);
  });
});

describe("Social review submission", () => {
  it("carries a score for a standard post that names a pub", () => {
    const parsed = parseSocialCreateSubmission({ ...scored, reviewRating: 4.5 }, false);
    expect(parsed.ok && parsed.reviewRating).toBe(4.5);
  });

  it("refuses a score off the scale or without a pub", () => {
    expect(parseSocialCreateSubmission({ ...scored, reviewRating: 4.2 }, false)).toMatchObject({ ok: false, code: "INVALID_REVIEW" });
    expect(parseSocialCreateSubmission({ ...scored, venueId: undefined, reviewRating: 4 }, false)).toMatchObject({ ok: false, code: "INVALID_REVIEW" });
    expect(parseSocialCreateSubmission({ ...scored, kind: "feature_request", reviewRating: 4 }, false)).toMatchObject({ ok: false, code: "INVALID_REVIEW" });
  });

  it("treats an absent score as no score", () => {
    const parsed = parseSocialCreateSubmission(scored, false);
    expect(parsed.ok && parsed.reviewRating).toBeNull();
  });
});

describe("memory Social review store", () => {
  it("re-scores in place, reads back by post, and ranks only the author's own", async () => {
    let clock = Date.parse("2026-10-01T00:00:00Z");
    const store = createMemorySocialPostReviewStore({ now: () => new Date(clock += 1000) });
    const alice = { profileId: "alice" };
    const bob = { profileId: "bob" };
    await store.attach(alice, { id: "p1", venueId: "beehive" }, 3);
    await store.attach(alice, { id: "p1", venueId: "beehive" }, 4);
    await store.attach(alice, { id: "p2", venueId: "sol" }, 4.5);
    await store.attach(bob, { id: "p3", venueId: "beehive" }, 1);
    await expect(store.attach(bob, { id: "p1", venueId: "beehive" }, 5)).rejects.toThrow(/not found/);
    expect([...(await store.forPosts(["p1", "p3", "missing"])).entries()]).toEqual([["p1", { rating: 4 }], ["p3", { rating: 1 }]]);
    expect((await store.ranking(alice)).map((entry) => `${entry.venueId}:${entry.rating}`)).toEqual(["sol:4.5", "beehive:4"]);
  });
});
