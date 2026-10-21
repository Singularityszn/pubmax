import { describe, expect, it } from "vitest";

import { formatPriceRange } from "@/app/crawls/routeSummary";
import { formatGbp } from "@/lib/formatGbp";
import { formatSightingPrice } from "@/lib/feedSightings";
import { messageVenuePriceLine } from "@/lib/messageAttachments";
import { priceStamp } from "@/lib/ogBrand";
import { formatPlanInviteSpendBand } from "@/lib/shareArtifacts";
import { formatZoneGbp } from "@/lib/zones";

describe("displayed GBP values", () => {
  it.each([
    [0, "£0.00"],
    [5.4, "£5.40"],
    [12, "£12.00"],
    [5.678, "£5.68"],
  ] as const)("prints %s as %s", (value, expected) => {
    expect(formatGbp(value)).toBe(expected);
    expect(formatSightingPrice(value)).toBe(expected);
    expect(formatZoneGbp(value)).toBe(expected);
  });

  it.each([
    [5.4, "£5.40"],
    [12, "£12.00"],
    [5.678, "£5.68"],
  ] as const)("prints the recorded price %s in consumer output", (value, expected) => {
    expect(priceStamp(value)).toBe(expected);
    expect(messageVenuePriceLine(value)).toBe(`Cheapest pint ${expected}`);
    expect(formatPriceRange({ minGbp: value, maxGbp: value })).toBe(expected);
    expect(formatPlanInviteSpendBand({ minGbp: value, maxGbp: value })).toBe(`${expected} per pint`);
  });

  it("prints both ends of a range", () => {
    expect(formatPriceRange({ minGbp: 4.2, maxGbp: 6.5 })).toBe("£4.20-£6.50");
    expect(formatPlanInviteSpendBand({ minGbp: 4.2, maxGbp: 6.5 })).toBe("£4.20–£6.50 per pint");
  });

  it("retains each consumer's absent-price policy", () => {
    expect(formatZoneGbp(null)).toBe("–");
    expect(priceStamp(null)).toBeNull();
    expect(priceStamp(undefined)).toBeNull();
    expect(messageVenuePriceLine(null)).toBeNull();
    for (const value of [0, -1, NaN, Infinity]) {
      expect(priceStamp(value)).toBeNull();
      expect(messageVenuePriceLine(value)).toBeNull();
    }
  });
});
