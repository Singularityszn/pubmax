import { describe, expect, it, vi } from "vitest";

import { takeEarlyWarmJson } from "@/lib/mapEarlyWarm";
import { loadSlimVenuesFromPath } from "@/lib/venuesSlim";

describe("mapEarlyWarm", () => {
  it("reuses head-start JSON instead of fetching again", async () => {
    const payload = [
      {
        id: "venue-test",
        name: "Test Arms",
        lat: 51.5,
        lng: -0.1,
        cheapestPrice: 500,
        borough: "Camden",
      },
    ];
    window.__pubmaxMapWarm = {
      json: new Map([["/data/test-slim.json", Promise.resolve(payload)]]),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const rows = await loadSlimVenuesFromPath("/data/test-slim.json");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("venue-test");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(takeEarlyWarmJson("/data/test-slim.json")).toBeDefined();
    fetchSpy.mockRestore();
  });
});
