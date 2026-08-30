import { describe, expect, it } from "vitest";

import {
  invalidatePendingLondonVenueStream,
  nextLondonVenueStreamToken,
  visibleLondonVenueStreamState,
} from "@/components/map/pubmap/useLondonVenueStreaming";

describe("London wider Venue stream state", () => {
  it("invalidates every request below the street-zoom gate", () => {
    const generation = { current: 3 };

    expect(nextLondonVenueStreamToken(generation, 14.9, 15)).toBeNull();
    expect(generation.current).toBe(4);
    expect(nextLondonVenueStreamToken(generation, 15, 15)).toBe(5);
  });

  it("invalidates an in-flight viewport before the debounced replacement starts", () => {
    const generation = { current: 0 };
    const oldViewportToken = nextLondonVenueStreamToken(generation, 15, 15);

    invalidatePendingLondonVenueStream(generation);

    expect(oldViewportToken).toBe(1);
    expect(generation.current).toBe(2);
    expect(oldViewportToken).not.toBe(generation.current);
  });

  it("hides stale or disabled published Venues immediately", () => {
    const venue = {
      id: "venue-osm-n1",
      name: "Night Cafe",
      address: "",
      lat: 51.5,
      lng: -0.1,
      kind: "cafe" as const,
    };
    const published = { scopeKey: "london", count: 1, venues: [venue] };

    expect(visibleLondonVenueStreamState(published, "london", true)).toEqual({
      count: 1,
      venues: [venue],
    });
    expect(visibleLondonVenueStreamState(published, "manchester", true)).toEqual({
      count: 0,
      venues: [],
    });
    expect(visibleLondonVenueStreamState(published, "london", false)).toEqual({
      count: 0,
      venues: [],
    });
  });
});
