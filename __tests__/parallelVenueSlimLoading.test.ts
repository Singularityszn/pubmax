import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offlineCache", () => ({
  offlineCache: { get: async () => null, set: async () => true },
}));

import { loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";

afterEach(() => vi.unstubAllGlobals());

const discoveredCities = readdirSync("data/cities").filter((city) => existsSync(`data/cities/${city}/parallel_venues.json`));

describe("unpriced Parallel venues in runtime city packs", () => {
  it("ships a discovery pack for exactly the cities the run reports accepted venues in", () => {
    const summary = JSON.parse(readFileSync("data/parallel-discovery/summary.json", "utf8"));
    const reported = summary.cities.filter((city: { totalAccepted: number }) => city.totalAccepted > 0).map((city: { city: string }) => city.city);
    expect([...discoveredCities].sort()).toEqual([...reported].sort());
  });

  it("claims all-city coverage only when every slice of every city map is complete", () => {
    const summary = JSON.parse(readFileSync("data/parallel-discovery/summary.json", "utf8"));
    const maps = readdirSync("data/cities").filter((city) => existsSync(`data/cities/${city}/osm_pubs.json`)).sort();
    expect(summary.cities.map((city: { city: string }) => city.city).sort()).toEqual(maps);
    for (const city of summary.cities) expect(city.complete).toBe(city.slicesComplete === city.slices);
    expect(summary.allCitiesComplete).toBe(summary.cities.every((city: { complete: boolean }) => city.complete));
  });

  it.each(discoveredCities)("loads the entire %s pack with its discoveries", async (city) => {
    const pack = JSON.parse(readFileSync(`public/data/cities/${city}/venues_slim.core.json`, "utf8"));
    const discoveries = JSON.parse(readFileSync(`data/cities/${city}/parallel_venues.json`, "utf8"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(pack))));
    const loaded = await loadSlimVenuesFromPathResult(`/parallel-test/${city}`, { expectedRevision: pack.revision });
    expect(loaded.status).toBe("ready");
    expect(loaded.rows).toHaveLength(pack.rows.length);
    for (const venue of discoveries.venues) {
      expect(loaded.rows.find((row) => row.id === venue.id)).toMatchObject({ name: venue.name, kind: venue.kind, cheapestPrice: null });
    }
  });

  it.each([
    { cheapestPrice: 12 },
    { cheapestPrice: null, anchorLabel: "House cocktail" },
    { cheapestPrice: null, anchorCourse: "main" },
  ])("still rejects priced or incomplete anchor claims: %j", async (claim) => {
    const row = { id: "venue-test-anchor", name: "Test Bar", kind: "bar", borough: "Leeds", lat: 53.8, lng: -1.55, ...claim };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ revision: "test", rows: [row] }))));
    const loaded = await loadSlimVenuesFromPathResult(`/parallel-test/${JSON.stringify(claim)}`, { expectedRevision: "test" });
    expect(loaded).toEqual({ rows: [], status: "unavailable" });
  });
});
