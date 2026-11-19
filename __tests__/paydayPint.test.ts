import { describe, expect, it } from "vitest";
import { selectPaydayPints } from "@/lib/paydayPint";

describe("payday pints", () => {
  it("selects attributed, dated prices near the chosen station", () => {
    const station = { name: "Example", lat: 51.5, lng: -0.1 };
    const rows = [
      { id: "near", name: "Nearby", lat: 51.5, lng: -0.1, priceSource: "Publisher", fairPint: [450, "https://example.com/price", "2026-11-01"] },
      { id: "far", name: "Far away", lat: 52, lng: -0.1, priceSource: "Publisher", fairPint: [100, "https://example.com/price", "2026-11-01"] },
      { id: "unknown", name: "Unknown", lat: 51.5, lng: -0.1, priceSource: "Publisher", fairPint: [200, "", "2026-11-01"] },
    ];
    expect(selectPaydayPints(station, rows)).toEqual([
      expect.objectContaining({ name: "Nearby", pricePence: 450, sourceUrl: "https://example.com/price", observedAt: "2026-11-01" }),
    ]);
  });
});
