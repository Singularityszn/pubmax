import { beforeEach, describe, expect, it, vi } from "vitest";

import { listEnabledCities, type CityId } from "@/lib/cities";
import { searchMapSearchIndex } from "@/lib/mapSearchIndex";
import type { SlimVenue, SlimVenueLoadResult } from "@/lib/venuesSlim";
import type { Venue } from "@/lib/venues";

const loadSlimVenuesForCityResult = vi.fn<(cityId: CityId) => Promise<SlimVenueLoadResult>>();
const writeSurfaceSnapshot = vi.fn();

vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCityResult: (cityId: CityId) => loadSlimVenuesForCityResult(cityId),
}));
vi.mock("@/lib/surfaceDataCache", () => ({
  readSurfaceSnapshot: () => undefined,
  writeSurfaceSnapshot: (...args: unknown[]) => writeSurfaceSnapshot(...args),
}));

function slimRow(id: string, name: string, borough: string): SlimVenue {
  return { id, name, borough, lat: 51.5, lng: -0.1 } as SlimVenue;
}

// The London pack as committed: three Dolphins across three boroughs, and the
// Blackfriar in the City.
const LONDON_PACK = [
  slimRow("venue-eltcmh", "The Blackfriar", "City of London"),
  slimRow("venue-12ino21", "The Dolphin Tavern", "Camden"),
  slimRow("venue-o1bguk", "The Dolphin", "Lewisham"),
  slimRow("venue-drjh14", "The Dolphin", "Hackney"),
];

// What the map holds after reading only the shards around its opening view.
const OPENING_SHARD_VENUES = [
  {
    id: "venue-12ino21",
    name: "The Dolphin Tavern",
    primaryBorough: "Camden",
    locality: undefined,
  },
] satisfies Pick<Venue, "id" | "name" | "primaryBorough" | "locality">[];

async function freshLoader() {
  vi.resetModules();
  return import("@/lib/mapSearchIndexLoader");
}

beforeEach(() => {
  loadSlimVenuesForCityResult.mockReset();
  writeSurfaceSnapshot.mockReset();
});

describe("loadMapSearchIndex", () => {
  it("answers for the whole current city, not just the shards the map has read", async () => {
    loadSlimVenuesForCityResult.mockImplementation(async (cityId) => ({
      rows: cityId === "london" ? LONDON_PACK : [],
      status: "ready",
    }));
    const { isCompleteMapSearchIndex, loadMapSearchIndex } = await freshLoader();

    const index = await loadMapSearchIndex({
      currentCityId: "london",
      currentVenues: OPENING_SHARD_VENUES,
    });

    expect(isCompleteMapSearchIndex(index)).toBe(true);
    expect(loadSlimVenuesForCityResult).toHaveBeenCalledWith("london");
    const dolphins = searchMapSearchIndex(index, "Dolphin")
      .filter((result) => result.kind === "venue")
      .map((result) => result.id)
      .sort();
    expect(dolphins).toEqual(["venue-12ino21", "venue-drjh14", "venue-o1bguk"]);
    expect(
      searchMapSearchIndex(index, "Blackfriar").some((result) => result.id === "venue-eltcmh"),
    ).toBe(true);
    expect(writeSurfaceSnapshot).toHaveBeenCalledTimes(1);
  });

  it("keeps a held venue the city pack lacks", async () => {
    loadSlimVenuesForCityResult.mockResolvedValue({ rows: [], status: "ready" });
    const { loadMapSearchIndex } = await freshLoader();

    const index = await loadMapSearchIndex({
      currentCityId: "london",
      currentVenues: OPENING_SHARD_VENUES,
    });

    expect(index.venues).toContainEqual({
      id: "venue-12ino21",
      name: "The Dolphin Tavern",
      area: "Camden",
      cityId: "london",
    });
  });

  it("asks again on the next search when a city pack did not load", async () => {
    loadSlimVenuesForCityResult.mockImplementation(async (cityId) =>
      cityId === "london"
        ? { rows: [], status: "unavailable" }
        : { rows: [], status: "ready" },
    );
    const { isCompleteMapSearchIndex, loadMapSearchIndex } = await freshLoader();

    const partial = await loadMapSearchIndex({
      currentCityId: "london",
      currentVenues: OPENING_SHARD_VENUES,
    });
    expect(isCompleteMapSearchIndex(partial)).toBe(false);
    expect(writeSurfaceSnapshot).not.toHaveBeenCalled();

    loadSlimVenuesForCityResult.mockImplementation(async (cityId) => ({
      rows: cityId === "london" ? LONDON_PACK : [],
      status: "ready",
    }));
    const retried = await loadMapSearchIndex({ currentCityId: "london" });

    expect(loadSlimVenuesForCityResult).toHaveBeenCalledTimes(
      listEnabledCities().length * 2,
    );
    expect(retried.venues.map((venue) => venue.id)).toContain("venue-eltcmh");
    expect(isCompleteMapSearchIndex(retried)).toBe(true);
    expect(writeSurfaceSnapshot).toHaveBeenCalledTimes(1);
  });
});
