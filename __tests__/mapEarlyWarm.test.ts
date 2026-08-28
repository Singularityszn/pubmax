import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

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
    vi.stubGlobal("window", {
      __pubmaxMapWarm: {
        json: new Map([["/data/test-slim.json", Promise.resolve(payload)]]),
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const rows = await loadSlimVenuesFromPath("/data/test-slim.json");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("venue-test");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("warms granted geolocation cells before the London fallback", async () => {
    const manifest = {
      shards: [
        { url: "/data/london.json", bbox: [-0.3, 51.3, -0.1, 51.6] },
        { url: "/data/granted.json", bbox: [0.1, 51.7, 0.4, 51.75] },
      ],
    };
    const fetchSpy = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === "/data/venues_slim.manifest.json?v=deploy-42" ? manifest : []),
    }));
    const query = vi.fn(async () => ({ state: "granted" } as PermissionStatus));
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 51.74, longitude: 0.25 } } as GeolocationPosition);
    });
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      localStorage: { getItem: vi.fn(() => null) },
    };

    const script = readFileSync(
      new URL("../public/map-first-paint-init.js", import.meta.url),
      "utf8",
    );
    const context = {
      window,
      document: { currentScript: { src: "https://pubmaxxing.com/map-first-paint-init.js?v=deploy-42" } },
      navigator: {
        connection: null,
        permissions: { query },
        geolocation: { getCurrentPosition },
      },
      fetch: fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
    };
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", script)(
      window,
      context.document,
      context.navigator,
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(query).toHaveBeenCalledOnce();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain(
      "/data/venues_slim.manifest.json?v=deploy-42",
    );
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain("/data/granted.json");
    expect(fetchSpy.mock.calls.map(([input]) => input)).not.toContain("/data/london.json");
  });
});
