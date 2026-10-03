import { describe, expect, it } from "vitest";

import { CLEAN_VENUE_ID_MAX, cleanVenueId, trimVenueId } from "@/lib/cleanVenueId";

describe("cleanVenueId", () => {
  it("strips controls, trims and caps, and occupancy can keep controls", () => {
    const dirty = `  venue-\u0007abc${"x".repeat(200)}  `;
    const cleaned = cleanVenueId(dirty);
    expect(cleaned).not.toContain("\u0007");
    expect(cleaned.startsWith("venue-")).toBe(true);
    expect(cleaned).toHaveLength(CLEAN_VENUE_ID_MAX);

    expect(cleanVenueId("  venue-1  ")).toBe("venue-1");
    expect(cleanVenueId("")).toBe("");
    expect(cleanVenueId("   ")).toBe("");
    expect(cleanVenueId(null)).toBe("");
    expect(cleanVenueId(12)).toBe("");

    expect(trimVenueId("ab\u0007c")).toBe("ab\u0007c");
    expect(trimVenueId(`  ${"y".repeat(80)}\u0001  `)).toBe("y".repeat(CLEAN_VENUE_ID_MAX));
  });
});
