import { afterEach, expect, it, vi } from "vitest";

import { loadPoisFromPath, type Poi } from "@/lib/pois";

afterEach(() => vi.unstubAllGlobals());

const station: Poi = {
  id: "station-test",
  name: "Test station",
  category: "tube",
  coordinates: [-0.12, 51.52],
  rank: 1,
};

it("shares one pending POI read between the map and route panel", async () => {
  vi.stubGlobal("window", {});
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const parse = vi.fn(() => [station]);
  const fetch = vi.fn(async () => {
    await gate;
    return { ok: true, json: parse };
  });
  vi.stubGlobal("fetch", fetch);

  const canvas = loadPoisFromPath("/data/poi-sharing-test.json");
  const route = loadPoisFromPath("/data/poi-sharing-test.json");
  release();
  const rows = await Promise.all([canvas, route]);

  expect(rows).toEqual([[station], [station]]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(parse).toHaveBeenCalledTimes(1);
});

it("reads changed POIs after the previous request settles", async () => {
  vi.stubGlobal("window", {});
  const changed = { ...station, name: "Renamed station" };
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify([station])))
    .mockResolvedValueOnce(new Response(JSON.stringify([changed])));
  vi.stubGlobal("fetch", fetch);

  expect(await loadPoisFromPath("/data/poi-freshness-test.json")).toEqual([station]);
  expect(await loadPoisFromPath("/data/poi-freshness-test.json")).toEqual([changed]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["offline", "http", "json"])("retries after a shared %s failure", async (failure) => {
  vi.stubGlobal("window", {});
  const fetch = vi.fn();
  if (failure === "offline") fetch.mockRejectedValueOnce(new Error("offline"));
  else fetch.mockResolvedValueOnce(new Response(failure === "json" ? "{" : "unavailable", {
    status: failure === "http" ? 503 : 200,
  }));
  fetch.mockResolvedValueOnce(new Response(JSON.stringify([station])));
  vi.stubGlobal("fetch", fetch);

  const path = `/data/poi-retry-${failure}-test.json`;
  const first = await Promise.allSettled([loadPoisFromPath(path), loadPoisFromPath(path)]);
  expect(first.map((result) => result.status)).toEqual(
    failure === "http" ? ["fulfilled", "fulfilled"] : ["rejected", "rejected"],
  );
  if (failure === "http") expect(first).toEqual([
    { status: "fulfilled", value: [] },
    { status: "fulfilled", value: [] },
  ]);
  expect(await loadPoisFromPath(path)).toEqual([station]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps city paths separate and skips cities without a POI layer", async () => {
  vi.stubGlobal("window", {});
  const other = { ...station, id: "other-station", name: "Other city station" };
  const fetch = vi.fn(async (path: string) => new Response(JSON.stringify([
    path === "/data/poi-city-a-test.json" ? station : other,
    { id: "invalid", coordinates: [null, null] },
  ])));
  vi.stubGlobal("fetch", fetch);

  expect(await Promise.all([
    loadPoisFromPath("/data/poi-city-a-test.json"),
    loadPoisFromPath("/data/poi-city-b-test.json"),
    loadPoisFromPath(null),
    loadPoisFromPath(undefined),
    loadPoisFromPath(""),
  ])).toEqual([[station], [other], [], [], []]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not share a module cache between server requests", async () => {
  vi.stubGlobal("window", undefined);
  const fetch = vi.fn(async () => new Response(JSON.stringify([station])));
  vi.stubGlobal("fetch", fetch);

  expect(await Promise.all([
    loadPoisFromPath("/data/poi-server-test.json"),
    loadPoisFromPath("/data/poi-server-test.json"),
  ])).toEqual([[station], [station]]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
