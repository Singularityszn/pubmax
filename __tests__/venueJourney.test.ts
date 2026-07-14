import { describe, expect, it } from "vitest";

import {
  optimalJourney,
  venueDirectionsUrl,
  type VenueJourney,
} from "@/lib/venueJourney";

function journey(
  durationMinutes: number,
  modes: string[],
): VenueJourney {
  return {
    durationMinutes,
    legs: modes.map((mode) => ({ mode })),
  };
}

describe("optimalJourney", () => {
  it("selects the shortest usable itinerary without reordering the input", () => {
    const journeys = [
      journey(24, ["walking", "tube"]),
      journey(15, ["walking", "bus", "walking"]),
      journey(19, ["walking", "tube"]),
    ];

    expect(optimalJourney(journeys)).toBe(journeys[1]);
    expect(journeys.map((item) => item.durationMinutes)).toEqual([24, 15, 19]);
  });

  it("ignores malformed itineraries and owns the empty case", () => {
    expect(
      optimalJourney([
        journey(Number.NaN, ["tube"]),
        journey(12, []),
      ]),
    ).toBeNull();
    expect(optimalJourney([])).toBeNull();
  });
});

describe("venueDirectionsUrl", () => {
  const venue = { lat: 51.5133, lng: -0.1349 };

  it("includes the user's coordinates as the directions origin", () => {
    const url = new URL(
      venueDirectionsUrl(venue, { lat: 51.5074, lng: -0.1278 }),
    );

    expect(url.searchParams.get("origin")).toBe("51.5074,-0.1278");
    expect(url.searchParams.get("destination")).toBe("51.5133,-0.1349");
    expect(url.searchParams.get("travelmode")).toBe("transit");
  });

  it("still creates a destination link when origin is unknown", () => {
    const url = new URL(venueDirectionsUrl(venue, null));
    expect(url.searchParams.has("origin")).toBe(false);
    expect(url.searchParams.get("destination")).toBe("51.5133,-0.1349");
  });
});
