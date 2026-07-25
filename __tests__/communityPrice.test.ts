import { describe, expect, it } from "vitest";

import {
  communityStampLabel,
  COMMUNITY_PRICE_MAX_GBP,
  COMMUNITY_PRICE_MIN_GBP,
  formatPriceDay,
  submitCategoryLabel,
  SUBMITTABLE_DRINK_CATEGORIES,
  validateCommunityPrice,
} from "@/lib/communityPrice";

// The shared trust boundary: the submit UI and /api/price-submit run THIS
// validator, so these cases pin the one contract both sides obey. A price that
// passes here is a price the map may carry; anything else must come back with a
// sentence a person at a bar can act on.

describe("validateCommunityPrice", () => {
  const base = { venueId: "venue-16pnwmm", drinkCategory: "beer" };

  it("accepts a plain price and normalises it to whole pennies", () => {
    const result = validateCommunityPrice({ ...base, priceGbp: 4.204 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      venueId: "venue-16pnwmm",
      drinkCategory: "beer",
      priceGbp: 4.2,
    });
  });

  it("accepts what a phone keypad actually produces", () => {
    // A pasted "£4.20", a stray space, and a comma decimal all mean £4.20.
    for (const typed of ["£4.20", " 4.20 ", "4,20"]) {
      const result = validateCommunityPrice({ ...base, priceGbp: typed });
      expect(result.ok, typed).toBe(true);
      if (result.ok) expect(result.value.priceGbp).toBe(4.2);
    }
  });

  it("rejects a price under the floor and offers the dropped-digit reading", () => {
    // £4.50 typed as £0.45 is the classic fat-finger - say so rather than
    // naming a constraint.
    const result = validateCommunityPrice({ ...base, priceGbp: 0.45 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(`Under £${COMMUNITY_PRICE_MIN_GBP}`);
    expect(result.error).toContain("£4.50");
  });

  it("rejects a price over the ceiling without inventing a correction", () => {
    const result = validateCommunityPrice({ ...base, priceGbp: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(`£${COMMUNITY_PRICE_MAX_GBP}`);
  });

  it("holds the boundaries themselves inside the envelope", () => {
    expect(validateCommunityPrice({ ...base, priceGbp: COMMUNITY_PRICE_MIN_GBP }).ok).toBe(true);
    expect(validateCommunityPrice({ ...base, priceGbp: COMMUNITY_PRICE_MAX_GBP }).ok).toBe(true);
    expect(validateCommunityPrice({ ...base, priceGbp: 0.99 }).ok).toBe(false);
    expect(validateCommunityPrice({ ...base, priceGbp: 30.01 }).ok).toBe(false);
  });

  it("requires a venue, a known drink category, and a numeric price", () => {
    expect(validateCommunityPrice({ ...base, venueId: "  ", priceGbp: 4.2 })).toEqual({
      ok: false,
      error: "A venue is required.",
    });
    expect(validateCommunityPrice({ ...base, drinkCategory: "mead", priceGbp: 4.2 })).toEqual({
      ok: false,
      error: "Pick what you're drinking.",
    });
    expect(validateCommunityPrice({ ...base, priceGbp: "abc" }).ok).toBe(false);
    expect(validateCommunityPrice({ ...base, priceGbp: "" }).ok).toBe(false);
    expect(validateCommunityPrice(null).ok).toBe(false);
  });

  it("strips control characters and caps an oversized venue id", () => {
    const result = validateCommunityPrice({
      venueId: `venue-\u0007abc${"x".repeat(200)}`,
      drinkCategory: "wine",
      priceGbp: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.venueId).not.toContain("\u0007");
    expect(result.value.venueId.length).toBe(64);
  });

  it("accepts every category the submit surface offers", () => {
    for (const category of SUBMITTABLE_DRINK_CATEGORIES) {
      const result = validateCommunityPrice({ ...base, drinkCategory: category, priceGbp: 6 });
      expect(result.ok, category).toBe(true);
      expect(submitCategoryLabel(category)).toBeTruthy();
    }
  });
});

describe("price day stamps", () => {
  // Fixed instants so the assertion never depends on the wall clock. Both sit
  // mid-afternoon London time, well clear of a midnight boundary.
  const now = Date.parse("2026-07-25T14:00:00Z");

  it("names today and yesterday, then falls back to a dated label", () => {
    expect(formatPriceDay(now, now)).toBe("today");
    expect(formatPriceDay(now - 86_400_000, now)).toBe("yesterday");
    expect(formatPriceDay(Date.parse("2026-07-03T14:00:00Z"), now)).toBe("3 Jul");
  });

  it("pairs the day with its source for the restamp caption", () => {
    expect(communityStampLabel(now, now)).toBe("today · community");
  });

  it("is honest-empty for a non-finite timestamp", () => {
    expect(formatPriceDay(Number.NaN, now)).toBe("");
    expect(communityStampLabel(Number.NaN, now)).toBe("community");
  });
});
