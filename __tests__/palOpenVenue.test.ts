import { describe, expect, it } from "vitest";

import {
  PAL_UNMATCHED_VENUE_NOTICE,
  palFlyToHref,
  palKnownVenueIds,
  resolvePalVenueOpenTarget,
} from "@/lib/palOpenVenue";
import { venueMapUrl } from "@/lib/venueMapUrl";

describe("palKnownVenueIds", () => {
  it("collects ids from slim rows", () => {
    const ids = palKnownVenueIds([
      { id: "venue-a", name: "A", lat: 0, lng: 0, cheapestPrice: null, borough: "City" },
      { id: "venue-b", name: "B", lat: 0, lng: 0, cheapestPrice: 4.2, borough: "City" },
    ]);
    expect(ids.has("venue-a")).toBe(true);
    expect(ids.has("venue-b")).toBe(true);
    expect(ids.size).toBe(2);
  });
});

describe("resolvePalVenueOpenTarget", () => {
  const known = new Set(["venue-a", "venue-mcr-iy010v"]);

  it("opens a listed London venue through venueMapUrl", () => {
    expect(resolvePalVenueOpenTarget("venue-a", known)).toEqual({
      kind: "open",
      href: venueMapUrl("venue-a"),
    });
  });

  it("opens a listed non-London venue through the city-aware map path", () => {
    expect(resolvePalVenueOpenTarget("venue-mcr-iy010v", known)).toEqual({
      kind: "open",
      href: "/map/manchester?sel=venue-mcr-iy010v",
    });
  });

  it("trusts the card id when the slim read has not answered yet", () => {
    expect(resolvePalVenueOpenTarget("venue-a", null)).toEqual({
      kind: "open",
      href: venueMapUrl("venue-a"),
    });
  });

  it("falls back to the map without selection when the id is not listed", () => {
    expect(resolvePalVenueOpenTarget("venue-unknown", known)).toEqual({
      kind: "fallback",
      href: "/map?mapNotice=unknown",
      notice: PAL_UNMATCHED_VENUE_NOTICE,
    });
  });

  it("falls back to the city map when an unmatched id names a non-London city", () => {
    expect(resolvePalVenueOpenTarget("venue-mcr-zzzzzz", known)).toEqual({
      kind: "fallback",
      href: "/map/manchester?mapNotice=unknown",
      notice: PAL_UNMATCHED_VENUE_NOTICE,
    });
  });

  it("refuses an empty id with the same unknown-pub line", () => {
    expect(resolvePalVenueOpenTarget("  ", known)).toEqual({
      kind: "fallback",
      href: "/map?mapNotice=unknown",
      notice: PAL_UNMATCHED_VENUE_NOTICE,
    });
  });
});

describe("palFlyToHref", () => {
  const known = new Set(["venue-a"]);

  it("opens the pub a fly names, because the map drops ?lat=&lng= inside London", () => {
    const href = palFlyToHref(
      { lat: 51.5113, lng: -0.119747, place: "The Anchor", venueId: "venue-a" },
      known,
    );
    expect(href).toBe(venueMapUrl("venue-a"));
    expect(new URL(href, "https://pubmaxxing.test").searchParams.has("lat")).toBe(false);
  });

  it("keeps the map-owned refusal for a named pub the index does not list", () => {
    expect(
      palFlyToHref({ lat: 51.5, lng: -0.1, place: "Gone", venueId: "venue-gone" }, known),
    ).toBe("/map?mapNotice=unknown");
  });

  it("opens the city map for a bare point inside a curated city, never a dropped arrival", () => {
    expect(palFlyToHref({ lat: 51.513, lng: -0.089, place: "Bank" }, known)).toBe("/map");
  });

  it("keeps the place arrival for a point outside every curated city", () => {
    expect(
      palFlyToHref({ lat: 53.3800941, lng: -1.4789213, place: "Sheffield" }, known),
    ).toBe("/map?place=Sheffield&lat=53.3800941&lng=-1.4789213");
  });
});
