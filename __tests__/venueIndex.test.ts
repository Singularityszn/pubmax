import { promises as fs } from "fs";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import {
  buildVenueIndex,
  getVenueIndex,
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
      v({ id: "venue-b", name: "The Grapes" }), // no borough
    ]);
    const a = index.get("venue-a") as VenueRef;
    expect(a.name).toBe("The Nellie Dean");
    expect(a.borough).toBe("Westminster");
    expect(a.lat).toBe(51.51);
    expect(a.lng).toBe(-0.13);
    expect(index.get("venue-b")?.borough).toBe("London");
    expect(index.has("venue-unknown")).toBe(false);
  });
});

describe("getVenueIndex", () => {
  it("does not cache an empty index after a read failure", async () => {
    const readFile = vi.spyOn(fs, "readFile");
    readFile
      .mockRejectedValueOnce(new Error("missing index"))
      .mockImplementation(
        async () =>
        JSON.stringify([
          {
            id: "venue-retry",
            name: "The Retry Arms",
            borough: "Camden",
            lat: 51.52,
            lng: -0.14,
          },
        ]),
      );

    expect(await getVenueIndex()).toEqual(new Map());
    const retried = await getVenueIndex();

    expect(retried.get("venue-retry")).toMatchObject({
      name: "The Retry Arms",
      borough: "Camden",
    });
    expect(readFile.mock.calls.length).toBeGreaterThanOrEqual(2);
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
