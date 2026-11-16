import { describe, expect, it } from "vitest";

import { isNearbyVisit } from "@/lib/nearbyVisit";

const now = Date.parse("2026-11-15T20:00:00Z");
const venue = { lat: 51.5, lng: -0.1 };
const fix = { ...venue, accuracy: 20, timestamp: now };

describe("nearby visit proof", () => {
  it("accepts a fresh fix whose accuracy circle is within 200 metres", () => {
    expect(isNearbyVisit(fix, venue, now)).toBe(true);
    expect(isNearbyVisit({ ...fix, lat: venue.lat + 0.001 }, venue, now)).toBe(true);
    expect(isNearbyVisit({ ...fix, lat: venue.lat + 0.002 }, venue, now)).toBe(false);
  });

  it.each([
    null, { venueId: "pub", proven: true }, { ...fix, lat: 91 }, { ...fix, lng: -181 },
    { ...fix, lat: "51.5" }, { ...fix, accuracy: -1 }, { ...fix, accuracy: 101 },
    { ...fix, accuracy: undefined }, { ...fix, timestamp: now - 60_001 },
    { ...fix, timestamp: now + 10_001 }, { ...fix, timestamp: NaN },
    { ...fix, lat: venue.lat + 0.001, accuracy: 100 },
  ])("refuses malformed, stale or insufficiently precise proof %j", (raw) => {
    expect(isNearbyVisit(raw, venue, now)).toBe(false);
  });
});
