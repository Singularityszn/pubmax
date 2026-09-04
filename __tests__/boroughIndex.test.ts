import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoricPub } from "@/lib/historic";
import type { Venue } from "@/lib/venues";

// The two memos under test are per process, so every case resets them and the
// seams they read are mocked at the module boundary. The point of each case is
// the CACHING RULE, not the arithmetic: listBoroughs and allBoroughHeritageCounts
// keep their own tests (__tests__/boroughs.test.ts, __tests__/boroughHeritage.test.ts).

const loadPintPriceLandingVenues = vi.fn<() => Promise<Venue[]>>();
const loadHistoricPubs = vi.fn<() => Promise<HistoricPub[]>>();

vi.mock("@/lib/pintPriceLandingDataset.server", () => ({
  loadPintPriceLandingVenues: () => loadPintPriceLandingVenues(),
}));
vi.mock("@/lib/historic", () => ({
  loadHistoricPubs: () => loadHistoricPubs(),
}));

import {
  getBoroughHeritageCounts,
  getBoroughSummaries,
  resetBoroughIndexForTests,
} from "@/lib/boroughIndex.server";

function venue(over: Partial<Venue> & { id: string; name: string }): Venue {
  return {
    cheapestPrice: null,
    primaryBorough: "",
    visibleBoroughs: [],
    cheapestPint: "",
    ...over,
  } as Venue;
}

function historic(over: Partial<HistoricPub> & { slug: string }): HistoricPub {
  return {
    venueId: null,
    name: over.slug,
    borough: null,
    lat: null,
    lng: null,
    hook: "",
    facts: [],
    era: null,
    listed: null,
    sourced: true,
    ...over,
  } as HistoricPub;
}

beforeEach(() => {
  resetBoroughIndexForTests();
  loadPintPriceLandingVenues.mockReset();
  loadHistoricPubs.mockReset();
});

describe("getBoroughSummaries", () => {
  it("derives the borough table from the governed dataset seam", async () => {
    loadPintPriceLandingVenues.mockResolvedValue([
      venue({ id: "a", name: "A", primaryBorough: "Camden", cheapestPrice: 5.4 }),
      venue({ id: "b", name: "B", primaryBorough: "Camden", cheapestPrice: 4.9 }),
      venue({ id: "c", name: "C", primaryBorough: "Hackney", cheapestPrice: 6 }),
    ]);

    const boroughs = await getBoroughSummaries();

    expect(boroughs.map((borough) => borough.slug)).toEqual(["camden", "hackney"]);
    expect(boroughs[0]).toMatchObject({ name: "Camden", pubCount: 2, cheapestGbp: 4.9 });
  });

  it("reads the dataset once however many renders ask for it", async () => {
    loadPintPriceLandingVenues.mockResolvedValue([
      venue({ id: "a", name: "A", primaryBorough: "Camden", cheapestPrice: 5 }),
    ]);

    const first = await getBoroughSummaries();
    const second = await getBoroughSummaries();

    expect(second).toBe(first);
    expect(loadPintPriceLandingVenues).toHaveBeenCalledTimes(1);
  });

  it("never caches a degraded read, so one failure does not empty the index", async () => {
    loadPintPriceLandingVenues.mockResolvedValueOnce([]);
    expect(await getBoroughSummaries()).toEqual([]);

    loadPintPriceLandingVenues.mockResolvedValue([
      venue({ id: "a", name: "A", primaryBorough: "Camden", cheapestPrice: 5 }),
    ]);
    expect(await getBoroughSummaries()).toHaveLength(1);
    expect(loadPintPriceLandingVenues).toHaveBeenCalledTimes(2);
  });
});

describe("getBoroughHeritageCounts", () => {
  it("counts cited historic pubs by borough slug", async () => {
    loadHistoricPubs.mockResolvedValue([
      historic({ slug: "one", borough: "Camden" }),
      historic({ slug: "two", borough: "Camden" }),
      historic({ slug: "three", borough: "City of London" }),
      historic({ slug: "four", borough: null }),
    ]);

    const counts = await getBoroughHeritageCounts();

    expect(counts.get("camden")).toBe(2);
    expect(counts.get("city-of-london")).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("reads the historic file once however many renders ask for it", async () => {
    loadHistoricPubs.mockResolvedValue([historic({ slug: "one", borough: "Camden" })]);

    const first = await getBoroughHeritageCounts();
    const second = await getBoroughHeritageCounts();

    expect(second).toBe(first);
    expect(loadHistoricPubs).toHaveBeenCalledTimes(1);
  });

  it("never caches a degraded read", async () => {
    loadHistoricPubs.mockResolvedValueOnce([]);
    expect((await getBoroughHeritageCounts()).size).toBe(0);

    loadHistoricPubs.mockResolvedValue([historic({ slug: "one", borough: "Camden" })]);
    expect((await getBoroughHeritageCounts()).get("camden")).toBe(1);
    expect(loadHistoricPubs).toHaveBeenCalledTimes(2);
  });
});
