import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defined } from "@/__tests__/helpers/defined";

// The measured failure: around a deploy the HTML (its baked
// NEXT_PUBLIC_SW_VERSION) and the venue packs on the server disagree. Every
// pack was refused, `pubmax:first-pins` never fired, the reveal coordinator
// burnt its ceiling after scene-built on every load and no pin ever painted,
// with nothing in any log. These tests stage that skew against the real loader
// and hold it to two promises: the pins paint, and the skew is reported.

const stored = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/lib/offlineCache", () => ({
  offlineCache: {
    get: vi.fn(async (key: string) => stored.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return true;
    }),
  },
}));

const BAKED = "target";

// What the opening read asks for: the London phone view over the core cell.
const OPENING = { west: -0.14, south: 51.49, east: -0.1, north: 51.52 };
const OUTER = { west: 0.02, south: 51.47, east: 0.08, north: 51.5 };

function row(id: string, lat: number, lng: number) {
  return { id, name: id, lat, lng, cheapestPrice: null, borough: "x" };
}

function londonPacks(revisions: { manifest: string; core: string; cell: string }) {
  return {
    "/data/venues_slim.manifest.json": {
      version: 2,
      revision: revisions.manifest,
      grid: { originLat: 51, originLon: -1, latStep: 0.1, lonStep: 0.1 },
      shards: [
        { id: "core", core: true, url: "/data/venues_slim.core.json", count: 1, bbox: [-0.2, 51.45, 0.0, 51.55], partition: "grid" },
        { id: "cell", core: false, url: "/data/venues_slim.cell.e.json", count: 1, bbox: [0.0, 51.45, 0.1, 51.52], partition: "grid" },
      ],
    },
    "/data/venues_slim.core.json": { revision: revisions.core, rows: [row("core-1", 51.5, -0.12)] },
    "/data/venues_slim.cell.e.json": { revision: revisions.cell, rows: [row("cell-1", 51.48, 0.05)] },
  } as Record<string, unknown>;
}

type Served = { bodies: Record<string, unknown>; noStore?: Record<string, unknown> };

let requests: string[] = [];

function serve({ bodies, noStore = {} }: Served) {
  requests = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(init?.cache === "no-store" ? `${url} [no-store]` : url);
    const path = defined(url.split("?")[0]);
    const source = init?.cache === "no-store" && path in noStore ? noStore : bodies;
    if (path in source) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(source[path]) } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, body: null } as unknown as Response);
  });
}

function offline() {
  requests = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    requests.push(String(input));
    return Promise.reject(new TypeError("Failed to fetch"));
  });
}

async function productionLoader() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", BAKED);
  vi.resetModules();
  const shards = await import("@/lib/slimShards");
  const revision = await import("@/lib/mapDataRevision");
  return { createSlimShardLoader: shards.createSlimShardLoader, drain: revision.drainMapDataRevisionSkews };
}

beforeEach(() => {
  stored.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("a map whose packs disagree with the baked revision", () => {
  for (const [name, served] of [
    ["the previous deploy's packs (new HTML, old packs)", "previous"],
    ["the next deploy's packs (old HTML or worker, new packs)", "next"],
    ["packs a build never restamped", "local"],
  ] as const) {
    it(`paints first pins from ${name} and reports the skew`, async () => {
      const { createSlimShardLoader, drain } = await productionLoader();
      serve({ bodies: londonPacks({ manifest: served, core: served, cell: served }) });

      // The first-visit lane: core guessed before the manifest answers.
      const loader = createSlimShardLoader("london", { deferSpatial: true });
      const opening = await loader.initialResult(OPENING);

      expect(opening.status).toBe("ready");
      expect(opening.rows.map((venue) => venue.id)).toEqual(["core-1"]);
      // Its shards are read under the pack's own revision key (`local` is
      // never a cache key, as for the baked revision).
      const key = served === "local" ? "" : `?v=${served}`;
      expect(requests).toContain(`/data/venues_slim.core.json${key}`);
      expect(drain()).toEqual([
        `map manifest revision skew: expected ${BAKED}, served ${served}, adopted`,
      ]);

      // The ring after it fills in from the same adopted pack.
      const ring = await loader.inBounds(OUTER);
      expect(ring.map((venue) => venue.id)).toEqual(["cell-1"]);
      expect(requests).toContain(`/data/venues_slim.cell.e.json${key}`);
      expect(loader.coverageComplete(OUTER)).toBe(true);
    });
  }

  it("paints from the manifest lane too, and through core()", async () => {
    const { createSlimShardLoader } = await productionLoader();
    serve({ bodies: londonPacks({ manifest: "previous", core: "previous", cell: "previous" }) });

    const loader = createSlimShardLoader("london");
    const [core, opening] = await Promise.all([loader.core(), loader.initialResult(OPENING)]);

    expect(core.map((venue) => venue.id)).toEqual(["core-1"]);
    expect(opening).toMatchObject({ status: "ready" });
  });

  it("adopts nothing when a cache-bypassed read reaches the matching revision", async () => {
    const { createSlimShardLoader, drain } = await productionLoader();
    serve({
      bodies: londonPacks({ manifest: "previous", core: BAKED, cell: BAKED }),
      noStore: londonPacks({ manifest: BAKED, core: BAKED, cell: BAKED }),
    });

    const loader = createSlimShardLoader("london");
    const opening = await loader.initialResult(OPENING);

    expect(opening).toEqual({ rows: [row("core-1", 51.5, -0.12)], status: "ready" });
    expect(requests).toEqual([
      `/data/venues_slim.manifest.json?v=${BAKED}`,
      `/data/venues_slim.manifest.json?v=${BAKED} [no-store]`,
      `/data/venues_slim.core.json?v=${BAKED}`,
    ]);
    expect(drain()).toEqual([]);
  });

  it("reads the previous deploy's mirrored pack while offline", async () => {
    // What the previous deploy left on this phone: its manifest and its core,
    // both filed under its own revision.
    stored.set("venues_slim_manifest:v2:/data/venues_slim.manifest.json", londonPacks({ manifest: "previous", core: "previous", cell: "previous" })["/data/venues_slim.manifest.json"]);
    stored.set("venues_slim:v2:/data/venues_slim.core.json?v=previous", { revision: "previous", rows: [row("core-1", 51.5, -0.12)] });
    const { createSlimShardLoader, drain } = await productionLoader();
    offline();

    const opening = await createSlimShardLoader("london").initialResult(OPENING);

    expect(opening).toEqual({ rows: [row("core-1", 51.5, -0.12)], status: "ready" });
    expect(drain()).toEqual([
      `map manifest revision skew: expected ${BAKED}, served previous, adopted`,
    ]);
  });

  it("still refuses a shard that disagrees with its own manifest, and says so", async () => {
    const { createSlimShardLoader, drain } = await productionLoader();
    serve({ bodies: londonPacks({ manifest: BAKED, core: "previous", cell: BAKED }) });

    const opening = await createSlimShardLoader("london", { deferSpatial: true }).initialResult(OPENING);

    expect(opening).toEqual({ rows: [], status: "unavailable" });
    expect(drain()).toEqual([
      `map shard revision skew: expected ${BAKED}, served previous, refused`,
    ]);
  });

  it("reports a manifest it cannot read at all rather than going quiet", async () => {
    const { createSlimShardLoader, drain } = await productionLoader();
    serve({
      bodies: {
        ...londonPacks({ manifest: "previous", core: "previous", cell: "previous" }),
        "/data/venues_slim.manifest.json": { version: 2, revision: "previous", shards: "broken" },
      },
    });

    const opening = await createSlimShardLoader("london").initialResult(OPENING);

    expect(opening.status).toBe("unavailable");
    expect(drain()).toEqual([
      `map manifest revision skew: expected ${BAKED}, served previous, refused`,
    ]);
  });

  it("reports one skew once, however many shards say it", async () => {
    const { createSlimShardLoader, drain } = await productionLoader();
    serve({ bodies: londonPacks({ manifest: "previous", core: "previous", cell: "previous" }) });

    await createSlimShardLoader("london").initialResult(OPENING);
    await createSlimShardLoader("london", { bypassInFlight: true }).initialResult(OPENING);

    expect(drain()).toHaveLength(1);
  });
});

describe("the skew report", () => {
  it("survives the client error redaction with a short revision", async () => {
    const { mapDataRevisionSkewMessage } = await import("@/lib/mapDataRevision");
    const { buildClientErrorReport } = await import("@/lib/clientErrorReport");
    const sha = "949e0592b9ac6b8ee2b6b375fd5c686171791a30";

    const report = buildClientErrorReport({
      kind: "error",
      name: "MapDataRevisionSkew",
      message: mapDataRevisionSkewMessage({
        asset: "manifest",
        outcome: "adopted",
        expected: sha,
        served: "https://evil.example/?x=1",
      }),
      path: "/map",
    });

    expect(report).toEqual({
      kind: "error",
      name: "MapDataRevisionSkew",
      message: "map manifest revision skew: expected 949e0592b9ac, served other, adopted",
      route: "/map",
      shell: "web",
    });
  });
});
