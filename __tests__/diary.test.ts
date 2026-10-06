import { describe, expect, it } from "vitest";

import {
  DIARY_EARLIEST_VISITED_ON,
  clampDiaryReviewInput,
  diaryReviewLength,
  MAX_DIARY_REVIEW,
  compareDiaryEntries,
  diaryVisitedOnLabel,
  latestDiaryVisitedOn,
  resolveDiaryVisitedOn,
  validateDiaryEntryCreate,
  type DiaryEntry,
} from "@/lib/diary";

const NOW = new Date("2026-10-06T12:00:00Z");
const OWNER = "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function create(overrides: Record<string, unknown> = {}) {
  return validateDiaryEntryCreate(
    {
      ownerActor: OWNER,
      venueId: "venue-dove",
      venueName: "The Dove",
      visitedOn: "2026-10-04",
      rating: 4.5,
      review: "Back room was calm.",
      ...overrides,
    },
    NOW,
  );
}

describe("resolveDiaryVisitedOn", () => {
  it("defaults to today in London", () => {
    expect(resolveDiaryVisitedOn(undefined, NOW)).toBe("2026-10-06");
    expect(resolveDiaryVisitedOn("", NOW)).toBe("2026-10-06");
    expect(latestDiaryVisitedOn(NOW)).toBe("2026-10-06");
  });

  it("reads the London day, not the UTC day, just after midnight in summer", () => {
    expect(latestDiaryVisitedOn(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
  });

  it("accepts a real past day and today", () => {
    expect(resolveDiaryVisitedOn("2026-10-06", NOW)).toBe("2026-10-06");
    expect(resolveDiaryVisitedOn(" 2024-02-29 ", NOW)).toBe("2024-02-29");
  });

  it("refuses the future, a day before the floor and an impossible day", () => {
    expect(resolveDiaryVisitedOn("2026-10-07", NOW)).toBeNull();
    expect(resolveDiaryVisitedOn("1999-12-31", NOW)).toBeNull();
    expect(resolveDiaryVisitedOn(DIARY_EARLIEST_VISITED_ON, NOW)).toBe("2000-01-01");
    expect(resolveDiaryVisitedOn("2026-02-30", NOW)).toBeNull();
    expect(resolveDiaryVisitedOn("2026-10-04T10:00:00Z", NOW)).toBeNull();
    expect(resolveDiaryVisitedOn(20261004, NOW)).toBeNull();
  });
});

describe("validateDiaryEntryCreate", () => {
  it("accepts a rated visit and keeps it private", () => {
    const result = create();
    expect(result).toEqual({
      ok: true,
      value: {
        ownerActor: OWNER,
        venueId: "venue-dove",
        venueName: "The Dove",
        visitedOn: "2026-10-04",
        rating: 4.5,
        review: "Back room was calm.",
        visibility: "private",
      },
    });
  });

  it("accepts a visit with no rating and no review", () => {
    const result = create({ rating: undefined, review: undefined });
    expect(result.ok && result.value.rating).toBeNull();
    expect(result.ok && result.value.review).toBe("");
  });

  it.each([1, 1.5, 2.5, 4.5, 5, "3.5"])("accepts the rating %s", (rating) => {
    const result = create({ rating });
    expect(result.ok && result.value.rating).toBe(Number(rating));
  });

  it.each([0, 0.5, 4.2, 5.5, 6, -1, "nope", Number.NaN])("refuses the rating %s", (rating) => {
    const result = create({ rating });
    expect(result).toEqual({
      ok: false,
      error: "Pick a rating from 1 to 5 stars, in half stars.",
    });
  });

  it("refuses a missing owner, venue or name", () => {
    expect(create({ ownerActor: "handle:alice" }).ok).toBe(false);
    expect(create({ venueId: "" }).ok).toBe(false);
    expect(create({ venueName: "  " }).ok).toBe(false);
  });

  it("refuses a future day with a plain message", () => {
    const result = create({ visitedOn: "2026-10-07" });
    expect(result).toEqual({
      ok: false,
      error: "Pick the day you were there. It cannot be in the future.",
    });
  });

  it("refuses a review over the cap and any visibility but private", () => {
    expect(create({ review: "x".repeat(MAX_DIARY_REVIEW + 1) }).ok).toBe(false);
    expect(create({ review: "x".repeat(MAX_DIARY_REVIEW) }).ok).toBe(true);
    expect(create({ visibility: "public" }).ok).toBe(false);
    expect(create({ visibility: "friends" }).ok).toBe(false);
    expect(create({ visibility: "private" }).ok).toBe(true);
  });

  it.each([
    "Best Guinness in Soho!",
    "Hidden gem, great garden.",
    "Pint <3, Guinness >> the Crown",
    "Back room:\n  quiet,\tcalm.",
  ])(
    "stores the review %s exactly as written",
    (review) => {
      const result = create({ review });
      expect(result.ok && result.value.review).toBe(review);
    },
  );

  it("strips control characters and trims the ends of a review, nothing more", () => {
    const result = create({ review: "  Good\u0000 pint\r\nby the fire\u007F  " });
    expect(result.ok && result.value.review).toBe("Good pint\nby the fire");
  });

  it("counts the review cap in characters, so emoji fit up to 280", () => {
    expect(create({ review: "🍺".repeat(MAX_DIARY_REVIEW) }).ok).toBe(true);
    expect(create({ review: "🍺".repeat(MAX_DIARY_REVIEW + 1) }).ok).toBe(false);
  });

  it("never accepts an owner from the body: only the ownerActor argument counts", () => {
    const result = create({ owner: "profile:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
    expect(result.ok && result.value.ownerActor).toBe(OWNER);
  });
});

describe("ordering and labels", () => {
  const base: Omit<DiaryEntry, "id" | "visitedOn" | "createdAt"> = {
    ownerActor: OWNER,
    venueId: "v",
    venueName: "V",
    rating: null,
    review: "",
    visibility: "private",
  };

  it("sorts newest visit day first, then newest log, then id", () => {
    const rows: DiaryEntry[] = [
      { ...base, id: "a", visitedOn: "2026-10-01", createdAt: "2026-10-02T10:00:00Z" },
      { ...base, id: "b", visitedOn: "2026-10-04", createdAt: "2026-10-04T09:00:00Z" },
      { ...base, id: "c", visitedOn: "2026-10-04", createdAt: "2026-10-04T22:00:00Z" },
    ];
    expect([...rows].sort(compareDiaryEntries).map((row) => row.id)).toEqual(["c", "b", "a"]);
  });

  it("labels a London day as the calendar day it names", () => {
    expect(diaryVisitedOnLabel("2026-10-04")).toBe("Sun, 4 Oct 2026");
    expect(diaryVisitedOnLabel("not-a-day")).toBe("not-a-day");
  });
});

describe("review length is counted in code points", () => {
  it("counts an emoji once, as the server and the database do", () => {
    expect(diaryReviewLength("🍺")).toBe(1);
    expect(diaryReviewLength("a🍺b")).toBe(3);
    expect("🍺".length).toBe(2);
  });

  it("clamps typed input on a code point, never through a surrogate pair", () => {
    const typed = "🍺".repeat(MAX_DIARY_REVIEW + 20);
    const clamped = clampDiaryReviewInput(typed);
    expect(diaryReviewLength(clamped)).toBe(MAX_DIARY_REVIEW);
    expect(clamped).toBe("🍺".repeat(MAX_DIARY_REVIEW));
    expect(clampDiaryReviewInput("short")).toBe("short");
  });

  it("a clamped review always passes server validation", () => {
    const clamped = clampDiaryReviewInput("🍺".repeat(500));
    expect(create({ review: clamped }).ok).toBe(true);
    expect(create({ review: `${clamped}🍺` }).ok).toBe(false);
  });
});
