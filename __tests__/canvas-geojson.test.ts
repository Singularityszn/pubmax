import { describe, expect, it } from "vitest";

import {
  priceBucket,
  pubsToGeoJSON,
  routeToLine,
  routeToStops,
  truncateStopName,
  ROUTE_STOP_LABEL_MAX,
  bandCorridorGeoJSON,
} from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import { summariseWhatsOnByVenue } from "@/lib/whatsOnBadges";
import type { Venue } from "@/lib/venues";
import type { StoryBand } from "@/lib/storyBands";
import type { Landmark } from "@/lib/landmarks";

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-1",
    name: "The Test Arms",
    address: "Somewhere",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Southwark",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...overrides,
  } as Venue;
}

describe("priceBucket", () => {
  it("maps null to 3, and price bands to 0/1/2", () => {
    expect(priceBucket(null)).toBe(3);
    expect(priceBucket(5.5)).toBe(0);
    expect(priceBucket(7)).toBe(1);
    expect(priceBucket(7.01)).toBe(2);
  });
});

describe("routeToLine", () => {
  it("returns no features for <2 stops", () => {
    expect(routeToLine([]).features).toHaveLength(0);
    expect(routeToLine([makeVenue()]).features).toHaveLength(0);
  });

  it("returns a single LineString with coords in order for >=2", () => {
    const a = makeVenue({ id: "a", longitude: -0.1, latitude: 51.5 });
    const b = makeVenue({ id: "b", longitude: -0.2, latitude: 51.6 });
    const fc = routeToLine([a, b]);
    expect(fc.features).toHaveLength(1);
    const geom = fc.features[0]?.geometry;
    expect(geom?.type).toBe("LineString");
    expect((geom as GeoJSON.LineString).coordinates).toEqual([
      [-0.1, 51.5],
      [-0.2, 51.6],
    ]);
    // Marks the instant paint as the approximate (dashed) route until the
    // /api/walk-route road geometry upgrades it.
    expect(fc.features[0]?.properties).toEqual({ source: "straight" });
  });
});

describe("truncateStopName", () => {
  it("returns a short name unchanged (at and below the budget)", () => {
    expect(truncateStopName("The Ship")).toBe("The Ship");
    // Exactly at the budget stays whole.
    const exact = "x".repeat(ROUTE_STOP_LABEL_MAX);
    expect(truncateStopName(exact)).toBe(exact);
  });

  it("trims surrounding whitespace before measuring", () => {
    expect(truncateStopName("  The Ship  ")).toBe("The Ship");
  });

  it("truncates an over-long name with a single-glyph ellipsis", () => {
    const out = truncateStopName("The Old Bank of England");
    expect(out.endsWith("…")).toBe(true);
    expect([...out]).toHaveLength(ROUTE_STOP_LABEL_MAX);
    expect(out).toBe("The Old Bank of E…");
  });

  it("drops a trailing space before the ellipsis (no 'word …')", () => {
    // The 17-char cut lands right after a space; it must not survive next to
    // the ellipsis.
    expect(truncateStopName("The Crown Anchor Tavern")).toBe("The Crown Anchor…");
  });

  it("honours a custom max", () => {
    expect(truncateStopName("The Winchester", 6)).toBe("The W…");
  });
});

describe("routeToStops", () => {
  it("labels stops 1..n in order and preserves ids", () => {
    const a = makeVenue({ id: "a" });
    const b = makeVenue({ id: "b" });
    const c = makeVenue({ id: "c" });
    const fc = routeToStops([a, b, c]);
    expect(fc.features.map((f) => f.properties?.label)).toEqual(["1", "2", "3"]);
    expect(fc.features.map((f) => f.properties?.id)).toEqual(["a", "b", "c"]);
  });

  it("carries the full name and a truncated plaque name per stop", () => {
    const a = makeVenue({ id: "a", name: "The Ship" });
    const b = makeVenue({ id: "b", name: "The Old Bank of England" });
    const fc = routeToStops([a, b]);
    expect(fc.features.map((f) => f.properties?.name)).toEqual([
      "The Ship",
      "The Old Bank of England",
    ]);
    expect(fc.features.map((f) => f.properties?.stopName)).toEqual([
      "The Ship",
      "The Old Bank of E…",
    ]);
  });
});

describe("bandCorridorGeoJSON", () => {
  const catalog: Landmark[] = [
    { id: "lm-1", name: "One", icon: "tower", coordinates: [-0.1, 51.5] } as Landmark,
    { id: "lm-2", name: "Two", icon: "tower", coordinates: [-0.2, 51.6] } as Landmark,
  ];

  it("is empty when the band is undefined", () => {
    expect(bandCorridorGeoJSON(undefined, catalog).features).toHaveLength(0);
  });

  it("is empty when the band resolves to <2 anchors", () => {
    const band = { id: "b", name: "B", anchorLandmarkIds: ["lm-1"] } as unknown as StoryBand;
    expect(bandCorridorGeoJSON(band, catalog).features).toHaveLength(0);
  });

  it("draws a LineString when the band resolves to >=2 anchors", () => {
    const band = { id: "b", name: "B", anchorLandmarkIds: ["lm-1", "lm-2"] } as unknown as StoryBand;
    const fc = bandCorridorGeoJSON(band, catalog);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.geometry.type).toBe("LineString");
  });
});

describe("pubsToGeoJSON", () => {
  const signals = new Map<string, VenueSignal>();

  it("marks serves=false when a favoritePint returns no beer price", () => {
    const venue = makeVenue({ id: "no-beer" });
    const fc = pubsToGeoJSON([venue], signals, "some-unserved-beer");
    const props = fc.features[0]?.properties;
    expect(props?.serves).toBe(false);
    // No lens override, no beer price → bucket falls to null → 3.
    expect(props?.bucket).toBe(priceBucket(null));
  });

  it("falls back to venue hint categories for drinkKind without a lens", () => {
    const venue = makeVenue({
      id: "hinted",
      cheapestPrice: 6,
      filterHints: {
        searchText: "hinted",
        amenities: {
          food: false,
          cocktails: false,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: false,
        },
        curation: { nearWater: false, hasStory: false },
        canonical: false,
        scraped: false,
        drinkCategories: ["wine"],
      },
    });
    const fc = pubsToGeoJSON([venue], signals, null);
    const props = fc.features[0]?.properties;
    expect(props?.serves).toBe(true);
    expect(props?.bucket).toBe(priceBucket(6));
    expect(typeof props?.drinkKind).toBe("string");
  });

  it("defaults a hintless pub to the pint glyph, never a synthetic accent (The Black Friar)", () => {
    // venue-1sw9ofl's id hashes to the "cocktail" accent, which previously
    // painted this ale-led heritage pub with a martini pin. With no recorded
    // drinkCategories the resting pin must fall back to the honest pint glyph.
    const venue = makeVenue({ id: "venue-1sw9ofl", cheapestPrice: 6 });
    const props = pubsToGeoJSON([venue], signals, null).features[0]?.properties;
    expect(props?.drinkKind).toBe("pint");
  });

  it("keeps a hintless pub on the pint glyph even when it serves cocktails", () => {
    const venue = makeVenue({
      id: "venue-1sw9ofl",
      cheapestPrice: 6,
      amenities: { ...makeVenue().amenities, cocktails: true },
    });
    const props = pubsToGeoJSON([venue], signals, null).features[0]?.properties;
    expect(props?.drinkKind).toBe("pint");
  });

  it("uses venue-type glyphs and type-relative bands for famous bars and food", () => {
    const bar = makeVenue({ id: "bar", kind: "bar", priceBand: 1, cheapestPrice: 18 });
    const food = makeVenue({ id: "food", kind: "food", priceBand: 0, cheapestPrice: 12 });
    const [barFeature, foodFeature] = pubsToGeoJSON([bar, food], signals, null).features;
    expect(barFeature?.properties).toMatchObject({ kind: "bar", drinkKind: "coupe", bucket: 1 });
    expect(foodFeature?.properties).toMatchObject({ kind: "food", drinkKind: "skewer", bucket: 0 });
    expect(String(barFeature?.properties?.icon)).toContain("coupe-1");
    expect(String(foodFeature?.properties?.icon)).toContain("skewer-0");
  });
});

describe("pubsToGeoJSON whats-on badge join (W1)", () => {
  it("stamps hero kind + timed flag on venues with a tonight row, absent otherwise", () => {
    const a = makeVenue({ id: "with-quiz" });
    const b = makeVenue({ id: "no-events" });
    const summary = summariseWhatsOnByVenue([
      {
        id: "r1",
        venueId: "with-quiz",
        placeName: a.name,
        kind: "quiz",
        startsAt: "2026-07-12T19:00:00.000Z",
        title: "Quiz night",
        source: { label: "Org", url: "https://example.com" },
        observedAt: "2026-07-12T09:00:00.000Z",
        confidence: "listed",
      },
    ]);
    const fc = pubsToGeoJSON([a, b], new Map(), null, null, summary);
    const [pa, pb] = fc.features.map((f) => f.properties);
    expect(pa?.whatsOn).toBe("quiz");
    expect(pa?.whatsOnTimed).toBe(true);
    expect(pb?.whatsOn).toBeUndefined();
  });
});
