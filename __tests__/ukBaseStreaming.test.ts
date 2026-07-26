import { describe, expect, it } from "vitest";

import {
  nextUkBaseStreamToken,
  ukBasePubsWithinBounds,
} from "@/components/map/pubmap/useUkBaseStreaming";

describe("nextUkBaseStreamToken", () => {
  it("invalidates an in-flight request before declining a below-gate stream", () => {
    const generation = { current: 4 };
    const inFlightToken = generation.current;

    expect(nextUkBaseStreamToken(generation, 10, 13)).toBeNull();
    expect(generation.current).toBe(5);
    expect(inFlightToken).not.toBe(generation.current);
  });

  it("keeps padded fetch rows out of the accessible viewport list", () => {
    const pubs = [
      {
        id: "venue-uk-n-inside",
        name: "Inside Arms",
        address: "",
        lat: 53.8,
        lng: -1.55,
        curatedVenueId: "",
      },
      {
        id: "venue-uk-n-padding",
        name: "Padding Arms",
        address: "",
        lat: 53.95,
        lng: -1.8,
        curatedVenueId: "",
      },
    ];

    expect(
      ukBasePubsWithinBounds(pubs, {
        west: -1.7,
        south: 53.7,
        east: -1.4,
        north: 53.9,
      }).map((pub) => pub.id),
    ).toEqual(["venue-uk-n-inside"]);
  });
});
