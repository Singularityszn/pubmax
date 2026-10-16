import { describe, expect, it } from "vitest";

import {
  CONFIRMED_MAX_AGE_DAYS,
  LISTED_MAX_AGE_DAYS,
  priceAgeFor,
  priceAgeNote,
} from "@/lib/priceTier";

// Owner decision 16 Oct 2026: an aging price must look aging, never fresh, and
// the windows are the Price Standing ones (CONTEXT.md): 30 days for a drinker's
// confirmation, 365 for a published listing.

const NOW = Date.parse("2026-10-16T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe("priceAgeFor", () => {
  it("reads the standings' own windows", () => {
    expect(CONFIRMED_MAX_AGE_DAYS).toBe(30);
    expect(LISTED_MAX_AGE_DAYS).toBe(365);
  });

  it("keeps a drinker's log fresh for 30 days and no longer", () => {
    expect(priceAgeFor("drinker", daysAgo(1), NOW)).toBe("fresh");
    expect(priceAgeFor("drinker", daysAgo(30), NOW)).toBe("fresh");
    expect(priceAgeFor("drinker", daysAgo(31), NOW)).toBe("aging");
  });

  it("keeps a published price fresh for a year and no longer", () => {
    expect(priceAgeFor("published", daysAgo(31), NOW)).toBe("fresh");
    expect(priceAgeFor("published", daysAgo(365), NOW)).toBe("fresh");
    expect(priceAgeFor("published", daysAgo(366), NOW)).toBe("aging");
  });

  it("never lets a figure with no read day, a bad day or a future day claim fresh", () => {
    for (const lane of ["drinker", "published"] as const) {
      expect(priceAgeFor(lane, null, NOW)).toBe("aging");
      expect(priceAgeFor(lane, undefined, NOW)).toBe("aging");
      expect(priceAgeFor(lane, "", NOW)).toBe("aging");
      expect(priceAgeFor(lane, "not a date", NOW)).toBe("aging");
      expect(priceAgeFor(lane, Number.NaN, NOW)).toBe("aging");
      expect(priceAgeFor(lane, daysAgo(-2), NOW)).toBe("aging");
    }
  });

  it("accepts an epoch figure as well as an ISO day", () => {
    expect(priceAgeFor("drinker", NOW - 1000, NOW)).toBe("fresh");
    expect(priceAgeFor("published", "2026-10-02", NOW)).toBe("fresh");
  });
});

describe("priceAgeNote", () => {
  it("says why in words, so the shape is never alone", () => {
    expect(priceAgeNote("published", null)).toBe("No read date on record, so this price may have changed.");
    expect(priceAgeNote("published", daysAgo(400))).toBe("Read over a year ago, so this price may have changed.");
    expect(priceAgeNote("drinker", daysAgo(40))).toBe("Logged over 30 days ago, so this price may have changed.");
  });

  it("never calls an unreadable or future read day an old one", () => {
    const unchecked = "The read date on record cannot be checked, so this price may have changed.";
    expect(priceAgeNote("published", "not a date", NOW)).toBe(unchecked);
    expect(priceAgeNote("published", daysAgo(-3), NOW)).toBe(unchecked);
    expect(priceAgeNote("drinker", NOW + 86_400_000, NOW)).toBe(unchecked);
    expect(priceAgeNote("drinker", Number.NaN, NOW)).toBe(unchecked);
  });
});
