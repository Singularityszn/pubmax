import { describe, it, expect } from "vitest";

import { haversineMeters } from "@/lib/greatCircle.mjs";
import { haversineKm } from "@/lib/haversine";
import {
  haversineKm as scriptHaversineKm,
  haversineMeters as scriptHaversineMeters,
} from "@/scripts/lib/geo.mjs";

// London to Edinburgh, pinned when the two old formulas still agreed.
const LONDON_EDINBURGH_METRES = 533_652.20033900486;

// The single shared great-circle helper. All map "nearest" features depend on it,
// so pin its behaviour: zero for a point on itself, symmetric, ~111 km per degree
// of latitude, and a real London distance in a sane range.
describe("haversineKm", () => {
  it("is ~0 km for identical points", () => {
    expect(haversineKm([-0.1, 51.5], [-0.1, 51.5])).toBeCloseTo(0, 6);
  });

  it("is symmetric", () => {
    const a: [number, number] = [-0.12, 51.5];
    const b: [number, number] = [-0.08, 51.52];
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it("is ~111 km for one degree of latitude", () => {
    const d = haversineKm([0, 51], [0, 52]);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("gives a sane King's Cross → Waterloo distance (~3 km)", () => {
    const kingsCross: [number, number] = [-0.124, 51.5308];
    const waterloo: [number, number] = [-0.1133, 51.5033];
    const d = haversineKm(kingsCross, waterloo);
    expect(d).toBeGreaterThan(2.5);
    expect(d).toBeLessThan(3.6);
  });

  it("pins one London to Edinburgh result through the master and both adapters", () => {
    const londonLat = 51.5074;
    const londonLng = -0.1278;
    const edinburghLat = 55.9533;
    const edinburghLng = -3.1883;

    // samePubIdentity and the scripts call the module with latitude first.
    const metres = haversineMeters(londonLat, londonLng, edinburghLat, edinburghLng);
    expect(metres).toBe(LONDON_EDINBURGH_METRES);
    expect(scriptHaversineMeters(londonLat, londonLng, edinburghLat, edinburghLng)).toBe(metres);
    expect(scriptHaversineKm(londonLat, londonLng, edinburghLat, edinburghLng)).toBe(metres / 1_000);
    // nearestVenueIds calls the tuple adapter with GeoJSON [lng, lat] order.
    expect(haversineKm([londonLng, londonLat], [edinburghLng, edinburghLat])).toBe(metres / 1_000);
  });

  it("returns a finite half-circumference for antipodal polar points", () => {
    const south: [number, number] = [0, -89.92];
    const north: [number, number] = [180, 89.92];

    expect(haversineKm(south, north)).toBeCloseTo(20_015.086796020572, 9);
  });
});
