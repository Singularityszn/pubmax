import { describe, expect, it } from "vitest";

import {
  agreesWithinTolerance,
  communityStampLabel,
  COMMUNITY_PRICE_CORROBORATION_THRESHOLD,
  COMMUNITY_PRICE_MAX_AGE_MS,
  COMMUNITY_PRICE_MAX_GBP,
  COMMUNITY_PRICE_MIN_GBP,
  drivesMap,
  formatPriceDay,
  isCorroborated,
  isWithinMaxAge,
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

// The agreement window: when do two reports of the same drink at the same pub
// count as the SAME observation? Getting this wrong is expensive in both
// directions - too tight and nothing ever corroborates, so the community layer
// never reaches the map at all; too loose and two different drinks vouch for
// each other. The rule is "the wider of 50p and 10%", so both the pint case and
// the cocktail case land where a drinker would say they land.
describe("agreesWithinTolerance", () => {
  it("accepts the pint case the 10% rule alone would reject", () => {
    // 10% of £4.20 is 42p, so a percentage-only window would refuse two honest
    // reports of the same pub's pint. The 50p floor is what makes the feature
    // able to corroborate anything at typical London pint prices.
    expect(agreesWithinTolerance(4.2, 4.5)).toBe(true);
    expect(agreesWithinTolerance(4.2, 4.7)).toBe(true);
    expect(agreesWithinTolerance(4.2, 3.7)).toBe(true);
  });

  it("rejects a pint report that is plainly a different drink", () => {
    expect(agreesWithinTolerance(4.2, 4.75)).toBe(false);
    expect(agreesWithinTolerance(4.2, 6)).toBe(false);
    expect(agreesWithinTolerance(4.2, 3.65)).toBe(false);
  });

  it("widens with the price, so top-of-envelope drinks can still agree", () => {
    // 10% of £18 is £1.80 - the 50p floor would be absurdly strict here.
    expect(agreesWithinTolerance(18, 18.9)).toBe(true);
    expect(agreesWithinTolerance(18, 19.8)).toBe(true);
    expect(agreesWithinTolerance(18, 19.85)).toBe(false);
  });

  it("compares in whole pennies, so binary floating point can't refuse an exact edge", () => {
    // 4.7 - 4.2 is 0.5000000000000004 in IEEE 754; a naive `<= 0.5` fails this.
    expect(agreesWithinTolerance(4.2, 4.7)).toBe(true);
    expect(agreesWithinTolerance(1.1, 1.6)).toBe(true);
    expect(agreesWithinTolerance(29.9, 29.9)).toBe(true);
  });

  it("is honest-false for a non-finite figure rather than accepting it", () => {
    expect(agreesWithinTolerance(Number.NaN, 4.2)).toBe(false);
    expect(agreesWithinTolerance(4.2, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

// The two map gates, as predicates. mergeCommunityPriceSignals enforces them;
// these pin the policy itself so a threshold change is a deliberate edit here.
describe("community price map gates", () => {
  const now = Date.parse("2026-07-26T20:00:00Z");

  it("needs a second independent submitter before a price is corroborated", () => {
    expect(COMMUNITY_PRICE_CORROBORATION_THRESHOLD).toBe(2);
    expect(isCorroborated({ corroborations: 1 })).toBe(false);
    expect(isCorroborated({ corroborations: 2 })).toBe(true);
    // An absent count is the cautious reading, never a free pass.
    expect(isCorroborated({})).toBe(false);
  });

  it("holds the map for 30 days, then hands it back", () => {
    expect(COMMUNITY_PRICE_MAX_AGE_MS).toBe(30 * 86_400_000);
    expect(isWithinMaxAge({ submittedAt: now }, now)).toBe(true);
    expect(isWithinMaxAge({ submittedAt: now - COMMUNITY_PRICE_MAX_AGE_MS }, now)).toBe(true);
    expect(isWithinMaxAge({ submittedAt: now - COMMUNITY_PRICE_MAX_AGE_MS - 1 }, now)).toBe(false);
    expect(isWithinMaxAge({ submittedAt: now - 31 * 86_400_000 }, now)).toBe(false);
    expect(isWithinMaxAge({ submittedAt: Number.NaN }, now)).toBe(false);
  });

  it("only drives the map when BOTH gates pass", () => {
    expect(drivesMap({ corroborations: 2, submittedAt: now }, now)).toBe(true);
    expect(drivesMap({ corroborations: 1, submittedAt: now }, now)).toBe(false);
    expect(drivesMap({ corroborations: 9, submittedAt: now - 31 * 86_400_000 }, now)).toBe(false);
  });
});
