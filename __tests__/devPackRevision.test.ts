import { afterEach, describe, expect, it, vi } from "vitest";

import { LOCAL_DATA_REVISION, requireDataRevision } from "@/lib/dataRevision.mjs";
import { defined } from "@/__tests__/helpers/defined";

// The revision next.config.mjs inlines as NEXT_PUBLIC_SW_VERSION is the one a
// production map client holds every pack to; outside production it holds none.
// These tests take it from the real rule and
// hand it to the real loader, over packs stamped the ways a checkout leaves
// them: committed `local`, restamped with HEAD by a local pack build, or a mix
// of the two after London or the cities were rebuilt alone.

const SHA = "949e0592b9ac6b8ee2b6b375fd5c686171791a30";
const HEAD = SHA.slice(0, 12);

function slimRow(id: string, lat: number, lng: number) {
  return { id, name: id, lat, lng, cheapestPrice: null, borough: "x" };
}

function packs(stamps: { london: string; londonCore: string; greenwich: string; bath: string; bathCore: string }) {
  return {
    "/data/venues_slim.manifest.json": {
      version: 2,
      revision: stamps.london,
      grid: { originLat: 0, originLon: 0, latStep: 1, lonStep: 1 },
      shards: [
        { id: "core", core: true, url: "/data/venues_slim.core.json", count: 1, bbox: [-0.2, 51.45, 0.0, 51.55] },
        { id: "greenwich", core: false, borough: "Greenwich", url: "/data/venues_slim.greenwich.json", count: 1, bbox: [0.0, 51.46, 0.1, 51.52] },
      ],
    },
    "/data/venues_slim.json": { revision: stamps.london, rows: [slimRow("c1", 51.5, -0.1), slimRow("g1", 51.48, 0.05)] },
    "/data/venues_slim.core.json": { revision: stamps.londonCore, rows: [slimRow("c1", 51.5, -0.1)] },
    "/data/venues_slim.greenwich.json": { revision: stamps.greenwich, rows: [slimRow("g1", 51.48, 0.05)] },
    "/data/cities/bath/venues_slim.manifest.json": {
      version: 1,
      revision: stamps.bath,
      shards: [
        { id: "core", core: true, url: "/data/cities/bath/venues_slim.core.json", count: 1, bbox: [-2.4, 51.36, -2.32, 51.4] },
      ],
    },
    "/data/cities/bath/venues_slim.json": { revision: stamps.bath, rows: [slimRow("b1", 51.38, -2.36)] },
    "/data/cities/bath/venues_slim.core.json": { revision: stamps.bathCore, rows: [slimRow("b1", 51.38, -2.36)] },
  } as Record<string, unknown>;
}

async function loaderFor(
  env: Record<string, string | undefined>,
  bodies: Record<string, unknown>,
) {
  vi.stubEnv("NODE_ENV", env.NODE_ENV);
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", requireDataRevision(env, { workingTreeSha: SHA }));
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = defined(String(input).split("?")[0]);
    if (url in bodies) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(bodies[defined(url)]) } as Response);
    }
    return Promise.resolve({ ok: false, status: 404 } as Response);
  });
  vi.resetModules();
  const { createSlimShardLoader } = await import("@/lib/slimShards");
  return createSlimShardLoader;
}

async function cityMonolithIds(
  env: Record<string, string | undefined>,
  bodies: Record<string, unknown>,
): Promise<string[]> {
  await loaderFor(env, bodies);
  const { loadSlimVenuesForCityResult } = await import("@/lib/venuesSlim");
  const result = await loadSlimVenuesForCityResult("bath");
  return result.rows.map((venue) => venue.id);
}

async function loadedIds(
  createSlimShardLoader: Awaited<ReturnType<typeof loaderFor>>,
): Promise<string[]> {
  const london = createSlimShardLoader("london");
  const core = await london.core();
  const outer = await london.inBounds({ west: 0.0, south: 51.44, east: 0.12, north: 51.53 });
  const bath = await createSlimShardLoader("bath").core();
  return [...core, ...outer, ...bath].map((venue) => venue.id).sort();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("which packs the map accepts", () => {
  const DEV_ENVS = [
    { NODE_ENV: "development" },
    { NODE_ENV: "development", NEXT_PUBLIC_SW_VERSION: "stale-pin" },
  ];
  const STAMPS = {
    "committed local packs": { london: LOCAL_DATA_REVISION, londonCore: LOCAL_DATA_REVISION, greenwich: LOCAL_DATA_REVISION, bath: LOCAL_DATA_REVISION, bathCore: LOCAL_DATA_REVISION },
    "packs restamped with HEAD": { london: HEAD, londonCore: HEAD, greenwich: HEAD, bath: HEAD, bathCore: HEAD },
    "London rebuilt alone": { london: HEAD, londonCore: HEAD, greenwich: HEAD, bath: LOCAL_DATA_REVISION, bathCore: LOCAL_DATA_REVISION },
    "mixed within one pack": { london: HEAD, londonCore: LOCAL_DATA_REVISION, greenwich: "other", bath: LOCAL_DATA_REVISION, bathCore: HEAD },
  };

  for (const env of DEV_ENVS) {
    for (const [name, stamps] of Object.entries(STAMPS)) {
      it(`next dev (${JSON.stringify(env)}) loads ${name}`, async () => {
        const create = await loaderFor(env, packs(stamps));
        await expect(loadedIds(create)).resolves.toEqual(["b1", "c1", "g1"]);
        await expect(cityMonolithIds(env, packs(stamps))).resolves.toEqual(["b1"]);
      });
    }
  }

  it("a production build loads packs stamped with its own revision", async () => {
    const create = await loaderFor({ NODE_ENV: "production" }, packs(STAMPS["packs restamped with HEAD"]));
    await expect(loadedIds(create)).resolves.toEqual(["b1", "c1", "g1"]);
  });

  it("a production build still rejects every pack stamped with another revision", async () => {
    const create = await loaderFor({ NODE_ENV: "production" }, packs(STAMPS["committed local packs"]));
    await expect(loadedIds(create)).resolves.toEqual([]);

    const mixed = await loaderFor({ NODE_ENV: "production" }, packs(STAMPS["mixed within one pack"]));
    await expect(loadedIds(mixed)).resolves.toEqual([]);

    await expect(
      cityMonolithIds({ NODE_ENV: "production" }, packs(STAMPS["committed local packs"])),
    ).resolves.toEqual([]);
  });
});
