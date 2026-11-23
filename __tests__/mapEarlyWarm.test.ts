import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { offlineCache } from "@/lib/offlineCache";
import { createSlimShardLoader } from "@/lib/slimShards";
import { loadSlimVenuesFromPath, loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";

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
      revision: "deploy-42",
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
    let firstPinsListener: (() => void) | undefined;
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      location: { href: "https://pubmaxxing.com/map" },
      localStorage: { getItem: vi.fn(() => null) },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "pubmax:first-pins") firstPinsListener = listener;
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        if (event.type === "pubmax:first-pins") firstPinsListener?.();
        return true;
      }),
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
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", "URL", script)(
      window,
      context.document,
      context.navigator,
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
      URL,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    window.dispatchEvent({ type: "pubmax:first-pins" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((window as typeof window & { __pubmaxMapLocationExposed?: boolean }).__pubmaxMapLocationExposed).toBe(true);
    expect(query).toHaveBeenCalledOnce();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain(
      "/data/venues_slim.manifest.json?v=deploy-42",
    );
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain("/data/granted.json?v=deploy-42");
    expect(fetchSpy.mock.calls.map(([input]) => input)).not.toContain("/data/london.json");
  });

  it("ignores a legacy exact location when Permissions API is unavailable", async () => {
    const manifest = {
      revision: "deploy-42",
      shards: [
        { url: "/data/london.json", bbox: [-0.3, 51.3, -0.1, 51.6] },
        { url: "/data/granted.json", bbox: [0.1, 51.7, 0.4, 51.75] },
      ],
    };
    const fetchSpy = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === "/data/venues_slim.manifest.json?v=deploy-42" ? manifest : []),
    }));
    const getCurrentPosition = vi.fn();
    let firstPinsListener: (() => void) | undefined;
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      location: { href: "https://pubmaxxing.com/map" },
      localStorage: { getItem: vi.fn((key: string) => key === "pubmax:map-opening-location:v1"
        ? JSON.stringify({ lat: 51.74, lng: 0.25 }) : null) },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "pubmax:first-pins") firstPinsListener = listener;
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        if (event.type === "pubmax:first-pins") firstPinsListener?.();
        return true;
      }),
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
        geolocation: { getCurrentPosition },
      },
      fetch: fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
    };
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", "URL", script)(
      window,
      context.document,
      context.navigator,
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
      URL,
    );
    window.dispatchEvent({ type: "pubmax:first-pins" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain("/data/london.json?v=deploy-42");
    expect(fetchSpy.mock.calls.map(([input]) => input)).not.toContain("/data/granted.json?v=deploy-42");
  });

  it("uses fallback when the permission query fails", async () => {
    const manifest = {
      revision: "deploy-42",
      shards: [
        { url: "/data/london.json", bbox: [-0.3, 51.3, -0.1, 51.6] },
        { url: "/data/granted.json", bbox: [0.1, 51.7, 0.4, 51.75] },
      ],
    };
    const fetchSpy = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === "/data/venues_slim.manifest.json?v=deploy-42" ? manifest : []),
    }));
    const getCurrentPosition = vi.fn();
    let firstPinsListener: (() => void) | undefined;
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      location: { href: "https://pubmaxxing.com/map" },
      localStorage: { getItem: vi.fn(() => null) },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "pubmax:first-pins") firstPinsListener = listener;
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        if (event.type === "pubmax:first-pins") firstPinsListener?.();
        return true;
      }),
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
        permissions: { query: vi.fn(async () => { throw new Error("unsupported"); }) },
        geolocation: { getCurrentPosition },
      },
      fetch: fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
    };
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", "URL", script)(
      window,
      context.document,
      context.navigator,
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
      URL,
    );
    window.dispatchEvent({ type: "pubmax:first-pins" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain("/data/london.json?v=deploy-42");
    expect(fetchSpy.mock.calls.map(([input]) => input)).not.toContain("/data/granted.json?v=deploy-42");
  });

  it("uses the fallback when warmup geolocation throws", async () => {
    const manifest = {
      revision: "deploy-42",
      shards: [
        { url: "/data/london.json", bbox: [-0.3, 51.3, -0.1, 51.6] },
        { url: "/data/other.json", bbox: [0.1, 51.7, 0.4, 51.75] },
      ],
    };
    const fetchSpy = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === "/data/venues_slim.manifest.json?v=deploy-42" ? manifest : []),
    }));
    let firstPinsListener: (() => void) | undefined;
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      location: { href: "https://pubmaxxing.com/map" },
      localStorage: { getItem: vi.fn(() => null) },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "pubmax:first-pins") firstPinsListener = listener;
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        if (event.type === "pubmax:first-pins") firstPinsListener?.();
        return true;
      }),
    };
    const script = readFileSync(
      new URL("../public/map-first-paint-init.js", import.meta.url),
      "utf8",
    );
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", "URL", script)(
      window,
      { currentScript: { src: "https://pubmaxxing.com/map-first-paint-init.js?v=deploy-42" } },
      {
        connection: null,
        geolocation: { getCurrentPosition: vi.fn(() => { throw new Error("unsupported"); }) },
      },
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
      URL,
    );
    window.dispatchEvent({ type: "pubmax:first-pins" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain("/data/london.json?v=deploy-42");
    expect(fetchSpy.mock.calls.map(([input]) => input)).not.toContain("/data/other.json?v=deploy-42");
  });

  it("rejects a shard payload from another deployment revision", async () => {
    vi.stubGlobal("window", { __pubmaxMapWarm: { json: new Map() } });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          id: "stale-venue",
          name: "Stale Arms",
          lat: 51.5,
          lng: -0.1,
          cheapestPrice: null,
          borough: "Camden",
        },
      ],
    })));

    await expect(
      loadSlimVenuesFromPathResult("/data/venues_slim.cell.stale.json", {
        expectedRevision: "deploy-42",
      }),
    ).resolves.toEqual({ rows: [], status: "unavailable" });

    vi.unstubAllGlobals();
  });

  it.each([
    ["a first visit", false],
    ["a returning visit", true],
  ])("reads each shard once across the warm, the map and the fair-pint loaders on %s", async (_, firstPinsSeen) => {
    const digest = "abcdefghijklmnopqrstuv";
    const opening = { west: -0.13, south: 51.51, east: -0.11, north: 51.53 };
    const manifest = {
      version: 2,
      priceDatasetDigest: digest,
      grid: { originLat: 51.25, originLon: -0.575, latStep: 0.025, lonStep: 0.025 },
      shards: [
        { id: "core", core: true, url: "/data/venues_slim.core.json", count: 1, bbox: [-0.15, 51.5, -0.12, 51.525] },
        { id: "cell", core: false, partition: "grid", url: "/data/venues_slim.cell.a.json", count: 1, bbox: [-0.12, 51.5, -0.1, 51.525] },
      ],
    };
    const row = (id: string, lng: number) => ({ id, name: id, lat: 51.52, lng, cheapestPrice: 5, borough: "Camden" });
    const bodies: Record<string, unknown> = {
      "/data/venues_slim.manifest.json": manifest,
      "/data/venues_slim.core.json": { d: digest, rows: [row("core-pub", -0.125)] },
      "/data/venues_slim.cell.a.json": { d: digest, rows: [row("cell-pub", -0.115)] },
    };
    const requests: string[] = [];
    const cellPath = "/data/venues_slim.cell.a.json";
    let warmRequestedCell!: () => void;
    const warmCellRequested = new Promise<void>((resolve) => { warmRequestedCell = resolve; });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.split("?")[0] === cellPath) warmRequestedCell();
      return { ok: true, json: async () => bodies[url.split("?")[0] ?? url] } as Response;
    });
    let firstPinsListener: (() => void) | undefined;
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      location: { href: "https://pubmaxxing.com/map" },
      localStorage: { getItem: vi.fn((key: string) => (key === "pubmax:first-pins-seen:v1" && firstPinsSeen ? "1" : null)) },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "pubmax:first-pins") firstPinsListener = listener;
      }),
    };
    vi.stubGlobal("window", window);
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(offlineCache, "get").mockResolvedValue(null);
    vi.spyOn(offlineCache, "set").mockResolvedValue(true);
    const script = readFileSync(new URL("../public/map-first-paint-init.js", import.meta.url), "utf8");
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", "URL", script)(
      window,
      { currentScript: { src: "https://pubmaxxing.com/map-first-paint-init.js?v=local" } },
      { connection: null },
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
      URL,
    );

    const map = createSlimShardLoader("london", { deferSpatial: !firstPinsSeen });
    const first = await map.initialResult(opening);
    expect(first.rows.length).toBeGreaterThan(0);
    firstPinsListener?.();
    // The early warm has read the opening cell before the fair-pint card asks.
    await warmCellRequested;
    const warmMap = (window as unknown as { __pubmaxMapWarm: { json: Map<string, Promise<unknown>> } }).__pubmaxMapWarm.json;
    await warmMap.get(cellPath);
    // The fair-pint card asks first: the core the map opened on must still not be read again.
    const [fairPintRows, mapRows] = await Promise.all([
      createSlimShardLoader("london").inBounds(opening),
      map.inBounds(opening),
    ]);

    expect([...new Set([...first.rows, ...mapRows].map((venue) => venue.id))].sort()).toEqual(["cell-pub", "core-pub"]);
    expect(fairPintRows.map((venue) => venue.id).sort()).toEqual(["cell-pub", "core-pub"]);
    const perFile = Object.fromEntries(Object.keys(bodies).map((path) => [
      path,
      requests.filter((url) => url.split("?")[0] === path).length,
    ]));
    expect(perFile).toEqual(Object.fromEntries(Object.keys(bodies).map((path) => [path, 1])));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
