import { describe, expect, it } from "vitest";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import { nightAreaPublishesPrices } from "@/lib/pricedLanding";

describe("Night Area review renewal", () => {
  it("does not publish from an unsupported review window", () => {
    expect(NIGHT_AREAS.filter(nightAreaPublishesPrices)).toEqual([]);
    const area = structuredClone(NIGHT_AREAS[0]!);
    area.lastReviewedAt = "2026-01-01T00:00:00.000Z";
    area.reviewExpiresAt = "2099-01-01T00:00:00.000Z";
    expect(nightAreaPublishesPrices(area)).toBe(false);
  });
});
