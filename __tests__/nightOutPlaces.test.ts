import { describe, expect, it } from "vitest";

import {
  isCurrentNightOutPlace,
  isValidNightOutPlace,
  isValidNightOutPlaceSnapshot,
  placesForNightOutJob,
  type NightOutPlace,
} from "@/lib/nightOutPlaces";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function place(overrides: Partial<NightOutPlace> = {}): NightOutPlace {
  return {
    id: "night-place-restaurant-test",
    category: "restaurant",
    job: "near_pub_food",
    name: "The Test Kitchen",
    description: "A neighbourhood restaurant serving a short seasonal menu from an open kitchen.",
    address: "1 Test Street, Soho, W1D 3QF",
    area: "Soho",
    location: { lat: 51.513, lng: -0.131 },
    sourceUrl: "https://example.com/london/test-kitchen",
    sourceName: "example.com",
    observedAt: "2026-07-20T10:00:00.000Z",
    expiresAt: "2026-08-19T10:00:00.000Z",
    discoveredVia: "exa",
    extractedVia: "firecrawl",
    ...overrides,
  };
}

describe("night-out place contract", () => {
  it("accepts a sourced, current London row", () => {
    expect(isValidNightOutPlace(place())).toBe(true);
  });

  it("rejects missing provenance, mismatched jobs, slop and dirty URLs", () => {
    expect(isValidNightOutPlace(place({ sourceUrl: "" }))).toBe(false);
    expect(isValidNightOutPlace(place({ sourceUrl: "https://example.com/place?utm_source=test" }))).toBe(false);
    expect(isValidNightOutPlace(place({ sourceName: "another.example" }))).toBe(false);
    expect(isValidNightOutPlace(place({ sourceUrl: "https://localhost/place", sourceName: "localhost" }))).toBe(false);
    expect(isValidNightOutPlace(place({ job: "pre_pub_attraction" }))).toBe(false);
    expect(isValidNightOutPlace(place({ description: "Welcome to this vibrant hidden gem!" }))).toBe(false);
  });

  it("preserves canonical identity query parameters", () => {
    expect(isValidNightOutPlace(place({ sourceUrl: "https://example.com/place?id=A" }))).toBe(true);
    expect(isValidNightOutPlace(place({ sourceUrl: "https://example.com/place?b=2&a=1" }))).toBe(false);
  });

  it("requires empty and published snapshot states to tell the truth", () => {
    expect(
      isValidNightOutPlaceSnapshot({
        version: 1,
        generatedAt: NOW.toISOString(),
        status: "empty",
        provenanceRegistryVersion: 1,
        places: [],
      }),
    ).toBe(true);
    expect(
      isValidNightOutPlaceSnapshot({
        version: 1,
        generatedAt: NOW.toISOString(),
        status: "published",
        provenanceRegistryVersion: 1,
        places: [],
      }),
    ).toBe(false);
  });

  it("never serves expired, future-observed, or over-age rows", () => {
    expect(isCurrentNightOutPlace(place(), NOW)).toBe(true);
    expect(
      isCurrentNightOutPlace(place({ expiresAt: "2026-07-20T12:00:00.000Z" }), NOW),
    ).toBe(false);
    expect(
      isCurrentNightOutPlace(
        place({ observedAt: "2026-07-20T12:00:01.000Z", expiresAt: "2026-08-19T12:00:01.000Z" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isCurrentNightOutPlace(
        place({ observedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z" }),
        NOW,
      ),
    ).toBe(false);
  });

  it("returns only the requested night-out job inside the anchor radius", () => {
    const attraction = place({
      id: "night-place-attraction-test",
      category: "attraction",
      job: "pre_pub_attraction",
      name: "The Test Museum",
      location: { lat: 51.512, lng: -0.13 },
    });
    const far = place({
      id: "night-place-restaurant-far",
      name: "Far Kitchen",
      location: { lat: 51.6, lng: 0 },
    });
    expect(
      placesForNightOutJob([place(), attraction, far], {
        job: "near_pub_food",
        lat: 51.513,
        lng: -0.131,
        radiusKm: 1,
        limit: 5,
        now: NOW,
      }).map((row) => row.id),
    ).toEqual(["night-place-restaurant-test"]);
  });
});
