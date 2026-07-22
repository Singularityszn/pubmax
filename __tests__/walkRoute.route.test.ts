import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic route tests. The keyless default (ORS_API_KEY stripped in
// vitest.setup.ts) exercises the straight-line fallback with no network; the
// key-present path stubs the ORS provider so a routed line is proven without a
// live call. The cache uses the process-memory backend (isSupabaseConfigured is
// false under the test baseline), reset between tests.

import { __resetWalkRouteStore } from "@/lib/walkRouteStore";
import { encodeStops, type LngLat } from "@/lib/walkRoute";

const fetchWalkLeg = vi.hoisted(() => vi.fn());
const orsApiKey = vi.hoisted(() => vi.fn<() => string | null>(() => null));

vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLeg,
  orsApiKey,
  ORS_FOOT_WALKING_URL: "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
}));

import { GET } from "@/app/api/walk-route/route";

const A: LngLat = [-0.1005, 51.5136];
const B: LngLat = [-0.0975, 51.5142];
const C: LngLat = [-0.0951, 51.5155];

function get(stops: LngLat[] | string): Promise<Response> {
  const raw = typeof stops === "string" ? stops : encodeStops(stops);
  return GET(new Request(`https://pubmaxxing.com/api/walk-route?stops=${encodeURIComponent(raw)}`));
}

async function body(res: Response) {
  return (await res.json()) as { line: GeoJSON.FeatureCollection; source: "ors" | "straight" };
}

beforeEach(() => {
  __resetWalkRouteStore();
  fetchWalkLeg.mockReset();
  orsApiKey.mockReset();
  orsApiKey.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/walk-route", () => {
  it("returns an empty line for fewer than two stops", async () => {
    const res = await get([A]);
    expect(res.status).toBe(200);
    const { line, source } = await body(res);
    expect(line.features).toEqual([]);
    expect(source).toBe("straight");
  });

  it("keyless: draws the straight line and never calls ORS", async () => {
    const res = await get([A, B, C]);
    expect(res.status).toBe(200);
    const { line, source } = await body(res);
    expect(source).toBe("straight");
    expect(line.features[0].properties).toEqual({ source: "straight" });
    expect((line.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([A, B, C]);
    expect(fetchWalkLeg).not.toHaveBeenCalled();
  });

  it("key present: routes each leg through ORS and returns a solid ors line", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    fetchWalkLeg.mockImplementation(async (from: LngLat, to: LngLat) => [
      from,
      [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] as LngLat,
      to,
    ]);
    const res = await get([A, B, C]);
    const { line, source } = await body(res);
    expect(source).toBe("ors");
    expect(fetchWalkLeg).toHaveBeenCalledTimes(2);
    // Two 3-point legs stitched (shared vertices B dropped once) => 5 points.
    expect((line.features[0].geometry as GeoJSON.LineString).coordinates).toHaveLength(5);
  });

  it("serves a cached leg without re-calling ORS", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    fetchWalkLeg.mockResolvedValue([A, B]);
    await get([A, B]);
    expect(fetchWalkLeg).toHaveBeenCalledTimes(1);
    fetchWalkLeg.mockClear();
    const res = await get([A, B]);
    const { source } = await body(res);
    expect(source).toBe("ors");
    expect(fetchWalkLeg).not.toHaveBeenCalled();
  });

  it("falls back to straight for a leg ORS cannot route (mixed stays ors overall)", async () => {
    orsApiKey.mockReturnValue("ork_secret");
    fetchWalkLeg
      .mockResolvedValueOnce([A, [-0.099, 51.5139], B]) // leg 1 routed
      .mockResolvedValueOnce(null); // leg 2 unroutable -> straight
    const res = await get([A, B, C]);
    const { line, source } = await body(res);
    expect(source).toBe("ors");
    const coords = (line.features[0].geometry as GeoJSON.LineString).coordinates;
    expect(coords[coords.length - 1]).toEqual(C);
  });

  it("ignores malformed stops and never 500s", async () => {
    const res = await get("garbage;also,garbage");
    expect(res.status).toBe(200);
    const { source } = await body(res);
    expect(source).toBe("straight");
  });
});
