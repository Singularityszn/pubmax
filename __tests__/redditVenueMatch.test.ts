import { describe, expect, it } from "vitest";
// @ts-expect-error Plain-node harvest matcher has no declaration file.
import { matchPubNameToVenue } from "../scripts/lib/redditVenueMatch.mjs";

const roebuck = { id: "venue-a", name: "The Roebuck", borough: "Southwark", lat: 51.5, lng: -0.08 };

describe("Reddit venue identity", () => {
  it("accepts a unique exact London pub name", () => {
    expect(matchPubNameToVenue("The Roebuck", "Southwark", [roebuck])?.venueId).toBe("venue-a");
  });
  it("does not discard a contradictory location", () => {
    expect(matchPubNameToVenue("The Roebuck", "Camden", [roebuck])).toBeNull();
  });
  it("does not equate a name prefix with a venue", () => {
    expect(matchPubNameToVenue("The Roebuck", null, [{ ...roebuck, name: "The Roebuck Hotel" }])).toBeNull();
  });
  it("does not place a non-London pub in London", () => {
    expect(matchPubNameToVenue("The Roebuck", null, [{ ...roebuck, borough: "Oxford", lat: 51.75, lng: -1.26 }])).toBeNull();
  });
});
