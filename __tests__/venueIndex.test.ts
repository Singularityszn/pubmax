import { promises as fs } from "fs";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import {
  buildVenueIndex,
  getVenueIndex,
  lookupCanonicalVenue,
  resetVenueIndexForTests,
  venueMapUrl,
  type VenueRef,
} from "@/lib/venueIndex";
import type { Venue } from "@/lib/venues";

// buildVenueIndex only reads id/name/primaryBorough/latitude/longitude, so a
// partial cast keeps fixtures readable.
function v(over: Partial<Venue> & { id: string; name: string }): Venue {
  return {
    address: "",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "",
    visibleBoroughs: [],
    cheapestPrice: null,
    cheapestPint: "",
    ...over,
  } as Venue;
}

beforeEach(() => {
  resetVenueIndexForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetVenueIndexForTests();
});

describe("buildVenueIndex", () => {
  it("maps ids to name/borough/coords and falls back to London with no borough", () => {
    const index = buildVenueIndex([
      v({ id: "venue-a", name: "The Nellie Dean", primaryBorough: "Westminster", latitude: 51.51, longitude: -0.13 }),
      v({ id: "venue-b", name: "The Grapes", kind: "bar" }), // no borough
    ]);
    const a = index.get("venue-a") as VenueRef;
    expect(a.name).toBe("The Nellie Dean");
    expect(a.borough).toBe("Westminster");
    expect(a.lat).toBe(51.51);
    expect(a.lng).toBe(-0.13);
    expect(index.get("venue-b")?.borough).toBe("London");
    expect(index.get("venue-b")?.kind).toBe("bar");
    expect(index.has("venue-unknown")).toBe(false);
  });
});

describe("getVenueIndex", () => {
  it("does not cache an empty index when every city pack fails", async () => {
    const readFile = vi.spyOn(fs, "readFile");
    let failAll = true;
    readFile.mockImplementation(async () => {
      if (failAll) throw new Error("missing index");
      return JSON.stringify([
        {
          id: "venue-retry",
          name: "The Retry Arms",
          borough: "Camden",
          lat: 51.52,
          lng: -0.14,
        },
      ]);
    });

    expect(await getVenueIndex()).toEqual(new Map());
    failAll = false;
    const retried = await getVenueIndex();

    expect(retried.get("venue-retry")).toMatchObject({
      name: "The Retry Arms",
      borough: "Camden",
    });
    expect(readFile.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it("keeps other cities when one city pack is missing and retries only that city", async () => {
    const realRead = fs.readFile.bind(fs);
    let failManchester = true;
    const readFile = vi.spyOn(fs, "readFile").mockImplementation(async (file, ...args) => {
      if (failManchester && String(file).includes("cities/manchester/")) {
        throw new Error("missing manchester pack");
      }
      return realRead(file, ...(args as [BufferEncoding]));
    });

    const index = await getVenueIndex();

    expect(index.size).toBeGreaterThan(0);
    expect(index.has("venue-mcr-1lwo5lo")).toBe(false);
    expect(index.get("venue-oxf-16404bl")).toMatchObject({
      name: "Turf Tavern",
      borough: "Oxford",
    });

    // Loaded cities stay cached — only the failed pack is re-read.
    const callsAfterFirst = readFile.mock.calls.length;
    await getVenueIndex();
    expect(readFile.mock.calls.length).toBe(callsAfterFirst + 2);

    // Once the pack recovers, its venues appear without a restart.
    failManchester = false;
    const recovered = await getVenueIndex();
    expect(recovered.get("venue-mcr-1lwo5lo")).toMatchObject({
      name: "Peveril of the Peak",
      borough: "Manchester",
    });

    // Fully loaded now — memoized, no further reads.
    const callsAfterRecovery = readFile.mock.calls.length;
    await getVenueIndex();
    expect(readFile.mock.calls.length).toBe(callsAfterRecovery);
  });

  it("includes enabled city slim packs, not just London", async () => {
    const index = await getVenueIndex();

    expect(index.get("venue-oxf-16404bl")).toMatchObject({
      name: "Turf Tavern",
      borough: "Oxford",
    });
    expect(index.get("venue-mcr-1lwo5lo")).toMatchObject({
      name: "Peveril of the Peak",
      borough: "Manchester",
      osmId: "way/100646638",
    });
    expect(index.get("bar-american-bar-savoy")?.kind).toBe("bar");
  });
});

describe("lookupCanonicalVenue", () => {
  it("distinguishes an unavailable city pack from an unknown venue", async () => {
    const realRead = fs.readFile.bind(fs);
    let failManchester = true;
    vi.spyOn(fs, "readFile").mockImplementation(async (file, ...args) => {
      if (failManchester && String(file).includes("cities/manchester/")) {
        throw new Error("missing manchester pack");
      }
      return realRead(file, ...(args as [BufferEncoding]));
    });

    expect(await lookupCanonicalVenue("venue-mcr-1lwo5lo")).toEqual({
      status: "unavailable",
      canonicalId: "venue-mcr-1lwo5lo",
    });

    failManchester = false;
    expect(await lookupCanonicalVenue("venue-mcr-1lwo5lo")).toMatchObject({
      status: "found",
      canonicalId: "venue-mcr-1lwo5lo",
      venue: { name: "Peveril of the Peak", borough: "Manchester" },
    });
    expect(await lookupCanonicalVenue("venue-mcr-doesnotexist")).toEqual({
      status: "unknown",
      canonicalId: "venue-mcr-doesnotexist",
    });
  });
});

describe("venueMapUrl", () => {
  it("builds a ?sel= link that the map reads to select the venue", () => {
    expect(venueMapUrl("venue-a")).toBe("/map?sel=venue-a");
    expect(venueMapUrl("venue-mcr-1lwo5lo")).toBe("/map/manchester?sel=venue-mcr-1lwo5lo");
    expect(venueMapUrl("venue-oxf-16404bl")).toBe("/map/oxford?sel=venue-oxf-16404bl");
    // encodes ids defensively
    expect(venueMapUrl("a b")).toBe("/map?sel=a%20b");
  });
});
