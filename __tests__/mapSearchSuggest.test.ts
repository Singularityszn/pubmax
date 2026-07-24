import { describe, expect, it } from "vitest";

import {
  buildMapSearchSuggestions,
  formatSuggestDistance,
  LOCALITY_FLY_ZOOM,
  SUGGEST_PUB_LIMIT,
} from "@/lib/mapSearchSuggest";
import { parseLocalityGazetteer, type Locality } from "@/lib/localities";
import { getNightArea, getNightAreasForCity } from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";
// The committed gazetteer — tests read it directly; the generation script
// (scripts/gen_london_localities.mjs) is never run here (hermetic).
import gazetteer from "@/public/data/london_localities.json";

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

// A tiny synthetic gazetteer — a locality, a modelled-area collision, and a
// same-named borough — so the ranking/dedup rules are exercised deterministically.
const LOCALITIES: Locality[] = [
  { name: "Willesden", lat: 51.549, lng: -0.229, borough: "Brent" },
  { name: "Cricklewood", lat: 51.556, lng: -0.213, borough: "Brent" },
  { name: "Shoreditch", lat: 51.524, lng: -0.079, borough: "Hackney" }, // modelled-area collision
];

describe("buildMapSearchSuggestions — localities (the basemap-label gap)", () => {
  it("surfaces a locality the basemap paints but the model never knew", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "willes",
      venues: [],
      localities: LOCALITIES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const willesden = result.areas.find((a) => a.name === "Willesden");
    expect(willesden).toBeDefined();
    expect(willesden?.kind).toBe("locality");
    expect(willesden?.center).toEqual([-0.229, 51.549]);
    expect(willesden?.contextLabel).toBe("Brent");
    expect(willesden?.areaNewsArea).toBe("brent");
  });

  it("gives a locality NO coverage chip and a deeper fly zoom (place, not a promise)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "cricklewood",
      venues: [],
      localities: LOCALITIES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const row = result.areas.find((a) => a.name === "Cricklewood");
    expect(row?.coverage).toBeNull();
    expect(row?.flyZoom).toBe(LOCALITY_FLY_ZOOM);
  });

  it("drops a locality that collides with a modelled area (no double Shoreditch)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "shoreditch",
      venues: [],
      localities: LOCALITIES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const shoreditches = result.areas.filter((a) => a.name === "Shoreditch");
    expect(shoreditches).toHaveLength(1);
    expect(shoreditches[0].kind).toBe("area");
    expect(shoreditches[0].areaNewsArea).toBe("shoreditch");
  });

  it("orders modelled area, then locality, then borough at an equal tier + distance", () => {
    // All three share a coordinate + a whole-label match, so only kind breaks the tie.
    const soho2 = getNightArea("piccadilly-soho");
    const pt: [number, number] = [soho2.centre.lng, soho2.centre.lat];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "riverside",
      venues: [venue({ id: "b1", primaryBorough: "Riverside", latitude: pt[1], longitude: pt[0] })],
      localities: [
        { name: "Soho", lat: pt[1], lng: pt[0], borough: "Westminster" }, // dropped: modelled alias
        { name: "Riverside", lat: pt[1], lng: pt[0], borough: "Wandsworth" },
      ],
      userLocation: null,
      mapCenter: pt,
      areaLimit: 20,
    });
    // "Riverside" exists as both a locality and a borough at the same point/tier;
    // the locality must rank ahead of the borough, and the borough is deduped out.
    const riverside = result.areas.filter((a) => a.name === "Riverside");
    expect(riverside).toHaveLength(1);
    expect(riverside[0].kind).toBe("locality");
  });

  it("ignores localities on an empty query (the prompt stays to modelled areas)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "",
      venues: [],
      localities: LOCALITIES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.areas.every((a) => a.kind === "area")).toBe(true);
  });
});

describe("london_localities.json — committed gazetteer integrity", () => {
  const localities = parseLocalityGazetteer(gazetteer);
  const [lonMin, latMin, lonMax, latMax] = gazetteer.bbox as [number, number, number, number];

  it("ships an ODbL / OpenStreetMap attribution header", () => {
    expect(gazetteer.license).toMatch(/odbl/i);
    expect(gazetteer.attribution).toMatch(/openstreetmap/i);
  });

  it("clears the count floor and matches its header count", () => {
    expect(localities.length).toBeGreaterThanOrEqual(300);
    expect(gazetteer.count).toBe(gazetteer.localities.length);
  });

  it("has finite coordinates inside the Greater London bbox for every row", () => {
    for (const l of localities) {
      expect(Number.isFinite(l.lat) && Number.isFinite(l.lng)).toBe(true);
      expect(l.lng).toBeGreaterThanOrEqual(lonMin);
      expect(l.lng).toBeLessThanOrEqual(lonMax);
      expect(l.lat).toBeGreaterThanOrEqual(latMin);
      expect(l.lat).toBeLessThanOrEqual(latMax);
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.borough.length).toBeGreaterThan(0);
    }
  });

  it("carries globally-unique normalised names (dedupe invariant)", () => {
    const norm = localities.map((l) => l.name.trim().toLowerCase().replace(/\s+/g, " "));
    expect(new Set(norm).size).toBe(norm.length);
  });

  it("never collides with a modelled Night Area name or alias", () => {
    const modelled = new Set<string>();
    for (const area of getNightAreasForCity("london")) {
      modelled.add(area.name.toLowerCase());
      for (const alias of area.aliases) modelled.add(alias.toLowerCase());
    }
    const collisions = localities.filter((l) => modelled.has(l.name.toLowerCase()));
    expect(collisions).toHaveLength(0);
  });
});
