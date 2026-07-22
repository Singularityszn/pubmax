import { describe, expect, it } from "vitest";

import {
  buildMapSearchSuggestions,
  formatSuggestDistance,
  SUGGEST_PUB_LIMIT,
} from "@/lib/mapSearchSuggest";
import { getNightArea } from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";

// Minimal Venue factory — only the fields the suggest models read matter.
// Mirrors the house pattern in __tests__/areaButton.test.ts.
function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Westminster",
    cheapestPrice: null,
    latestContributorPrice: null,
    ...overrides,
  } as Venue;
}

const shoreditch = getNightArea("shoreditch");
const soho = getNightArea("piccadilly-soho");

// A map centre far from Shoreditch so distance ordering is unambiguous.
const CENTRE: [number, number] = [soho.centre.lng, soho.centre.lat];

describe("formatSuggestDistance — honest, origin-aware register", () => {
  it("reads the viewer's own distance as 'away'", () => {
    expect(formatSuggestDistance(0, "user")).toBe("right here");
    expect(formatSuggestDistance(0.42, "user")).toBe("420 m away");
    expect(formatSuggestDistance(1.25, "user")).toBe("1.3 km away");
  });

  it("reads a map-centre distance as 'from centre', never as the viewer's", () => {
    expect(formatSuggestDistance(0, "map-centre")).toBe("at the centre");
    expect(formatSuggestDistance(0.42, "map-centre")).toBe("420 m from centre");
    expect(formatSuggestDistance(1.25, "map-centre")).toBe("1.3 km from centre");
  });

  it("returns empty for a non-finite or negative distance", () => {
    expect(formatSuggestDistance(Number.NaN, "user")).toBe("");
    expect(formatSuggestDistance(-1, "map-centre")).toBe("");
  });
});

describe("buildMapSearchSuggestions — the as-you-type popup model", () => {
  it("matches a modelled area by name (the Hackney screenshot gap: areas surface)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "shored",
      venues: [],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.areas.map((a) => a.slug)).toContain("shoreditch");
    expect(result.hasResults).toBe(true);
  });

  it("matches a modelled area by alias", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "hoxton", // Shoreditch alias
      venues: [],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.areas.map((a) => a.slug)).toContain("shoreditch");
  });

  it("surfaces a borough (like Hackney) that is not a modelled area, with a fly centre", () => {
    const venues = [
      venue({ id: "h1", primaryBorough: "Hackney", latitude: 51.545, longitude: -0.056 }),
      venue({ id: "h2", primaryBorough: "Hackney", latitude: 51.547, longitude: -0.058 }),
    ];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "hackney",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const hackney = result.areas.find((a) => a.name === "Hackney");
    expect(hackney).toBeDefined();
    expect(hackney?.kind).toBe("borough");
    // Fly centre is the centroid of its venues, in [lng, lat] order.
    expect(hackney?.center[0]).toBeCloseTo(-0.057, 2);
    expect(hackney?.center[1]).toBeCloseTo(51.546, 2);
    expect(hackney?.coverage).toBeNull();
  });

  it("never shows a borough that collides with a modelled area name (no duplicate Camden)", () => {
    const venues = [
      venue({ id: "c1", primaryBorough: "Camden", latitude: 51.539, longitude: -0.143 }),
    ];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "camden",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const camdens = result.areas.filter((a) => a.name === "Camden");
    expect(camdens).toHaveLength(1);
    expect(camdens[0].kind).toBe("area");
  });

  it("matches pubs by name and caps the group", () => {
    const venues = Array.from({ length: 10 }, (_, i) =>
      venue({ id: `crown-${i}`, name: `The Crown ${i}`, latitude: 51.51 + i * 0.001, longitude: -0.13 }),
    );
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "crown",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.pubs.length).toBe(SUGGEST_PUB_LIMIT);
    expect(result.pubs.every((p) => p.name.startsWith("The Crown"))).toBe(true);
  });

  it("labels pub distance from the viewer's GPS when present, else the map centre", () => {
    const near = venue({ id: "near", name: "The Local", latitude: 51.53, longitude: -0.1 });
    const withUser = buildMapSearchSuggestions({
      cityId: "london",
      query: "local",
      venues: [near],
      userLocation: { lat: 51.525, lng: -0.1 },
      mapCenter: CENTRE,
    });
    expect(withUser.origin).toBe("user");
    expect(withUser.pubs[0].distanceLabel).toContain("away");

    const withoutUser = buildMapSearchSuggestions({
      cityId: "london",
      query: "local",
      venues: [near],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(withoutUser.origin).toBe("map-centre");
    expect(withoutUser.pubs[0].distanceLabel).toContain("from centre");
  });

  it("carries a verified pub price when one exists, null otherwise", () => {
    const venues = [
      venue({ id: "priced", name: "Priced Arms", cheapestPrice: 5.2 }),
      venue({ id: "unpriced", name: "Unpriced Arms", cheapestPrice: null }),
    ];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "arms",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const priced = result.pubs.find((p) => p.id === "priced");
    const unpriced = result.pubs.find((p) => p.id === "unpriced");
    expect(priced?.priceLabel).toBe("£5.20");
    expect(unpriced?.priceLabel).toBeNull();
  });

  it("ranks pubs nearest-first within a tier", () => {
    const venues = [
      venue({ id: "far", name: "Anchor Far", latitude: 51.6, longitude: -0.3 }),
      venue({ id: "near", name: "Anchor Near", latitude: soho.centre.lat, longitude: soho.centre.lng }),
    ];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "anchor",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.pubs[0].id).toBe("near");
  });

  it("returns nearby areas and no pubs for an empty query (minimal prompt)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "   ",
      venues: [venue({ id: "x", name: "Whatever" })],
      userLocation: null,
      mapCenter: [shoreditch.centre.lng, shoreditch.centre.lat],
    });
    expect(result.isEmptyQuery).toBe(true);
    expect(result.pubs).toHaveLength(0);
    expect(result.areas.length).toBeGreaterThan(0);
    // Nearest area to a Shoreditch centre is Shoreditch itself.
    expect(result.areas[0].slug).toBe("shoreditch");
  });

  it("returns empty groups (not a match) for a query nothing answers", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "zzzznowhere",
      venues: [venue({ id: "x", name: "The Crown" })],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.hasResults).toBe(false);
    expect(result.areas).toHaveLength(0);
    expect(result.pubs).toHaveLength(0);
  });

  it("does not move the camera math when coords are non-finite (fails soft to no label)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "crown",
      venues: [venue({ id: "bad", name: "The Crown", latitude: Number.NaN, longitude: Number.NaN })],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.pubs[0].distanceLabel).toBe("");
  });
});
