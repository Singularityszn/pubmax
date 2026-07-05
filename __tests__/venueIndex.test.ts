import { describe, it, expect } from "vitest";

import { buildVenueIndex, venueMapUrl, type VenueRef } from "@/lib/venueIndex";
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

describe("venueMapUrl", () => {
  it("builds a ?sel= link that the map reads to select the venue", () => {
    expect(venueMapUrl("venue-a")).toBe("/map?sel=venue-a");
    // encodes ids defensively
    expect(venueMapUrl("a b")).toBe("/map?sel=a%20b");
  });
});
