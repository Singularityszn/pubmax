import { describe, expect, it } from "vitest";

import {
  priceBucket,
  pubsToGeoJSON,
  routeToLine,
  routeToStops,
  bandCorridorGeoJSON,
} from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
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
});
