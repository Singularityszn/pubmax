import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS_PX } from "@/components/map/canvas/buildScene";
import { CLUSTER_PRICE_NONE } from "@/components/map/canvas/filters";
import { formatPinPriceLabel, pubsToGeoJSON } from "@/components/map/canvas/geojson";
import { getCity } from "@/lib/cities";
import {
  clusterAtZoom,
  frameMatchesPreview,
  MAP_OPENING_PREVIEW_CAMERA,
  OPENING_CLUSTER_MAX_ZOOM,
  OPENING_CLUSTER_PRICE_NONE,
  OPENING_CLUSTER_RADIUS_PX,
  openingDiscClaims,
  projectAtCamera,
  type MapOpeningFrame,
} from "@/lib/mapOpeningPreview";
import { openingPreviewDiscs } from "@/lib/mapOpeningPreviewDiscs";
import { slimVenuesToPins } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";
import { defaultVenueKindVisibility, filterVenuesByKind } from "@/lib/venueKindFilters";

// The opening prices drawn by the /map document (lib/mapOpeningPreview.ts).
// These hold the arithmetic; e2e/map-opening-preview.spec.ts holds the same
// discs to the real engine's painted clusters in a browser.

const coreRows = (
  JSON.parse(readFileSync(join(process.cwd(), "public/data/venues_slim.core.json"), "utf8")) as {
    rows: SlimVenue[];
  }
).rows;

function coreFeatures() {
  const venues = filterVenuesByKind(slimVenuesToPins(coreRows), defaultVenueKindVisibility());
  return pubsToGeoJSON(venues, new Map(), null).features;
}

describe("the restated clustering", () => {
  it("is the pubs source's own", () => {
    expect(OPENING_CLUSTER_RADIUS_PX).toBe(CLUSTER_RADIUS_PX);
    expect(OPENING_CLUSTER_MAX_ZOOM).toBe(CLUSTER_MAX_ZOOM);
    expect(OPENING_CLUSTER_PRICE_NONE).toBe(CLUSTER_PRICE_NONE);
  });

  it("opens on London's view with its bearing cleared, as a cold first visit does", () => {
    const view = getCity("london").mapView;
    expect(MAP_OPENING_PREVIEW_CAMERA).toEqual({
      center: view.center,
      zoom: view.zoom,
      pitch: view.pitch,
      bearing: 0,
    });
  });
});

describe("clusterAtZoom", () => {
  const options = {
    radiusPx: 56,
    maxZoom: 13,
    zoom: 12,
    map: (p: { price: number }) => ({ min: p.price }),
    reduce: (into: { min: number }, next: { min: number }) => {
      into.min = Math.min(into.min, next.min);
    },
  };

  it("folds near neighbours into one cluster at their weighted centre and keeps the cheapest", () => {
    const points = [
      { lng: -0.1, lat: 51.5, properties: { price: 6 } },
      { lng: -0.1001, lat: 51.5001, properties: { price: 4.5 } },
      { lng: -0.1002, lat: 51.4999, properties: { price: 5 } },
    ];
    const [cluster] = clusterAtZoom(points, options);
    expect(cluster?.count).toBe(3);
    expect(cluster?.props.min).toBe(4.5);
    expect(cluster?.lng).toBeCloseTo(-0.1001, 6);
  });

  it("leaves a point with nobody in reach unclustered", () => {
    const points = [
      { lng: -0.1, lat: 51.5, properties: { price: 6 } },
      { lng: 0.2, lat: 51.6, properties: { price: 4.5 } },
    ];
    expect(clusterAtZoom(points, options)).toEqual([]);
  });

  it("mints the cluster id the engine mints, from the origin's place in its level", () => {
    const points = [
      { lng: -0.1, lat: 51.5, properties: { price: 6 } },
      { lng: -0.1001, lat: 51.5001, properties: { price: 4.5 } },
    ];
    const [cluster] = clusterAtZoom(points, options);
    // Formed at z13 from index 0, then carried into z12 untouched: (0 << 5) + 14 + 2.
    expect(cluster?.id).toBe(16);
  });
});

// Measured from maplibre-gl 6.13 itself: the clusters a cold first visit's
// phone painted at the moment its pins were revealed (390 x 844, through the
// app's own painted-pin probe), with their positions on screen. The engine's
// ids, centres and placement are the ground truth the build has to meet.
const ENGINE_PHONE_FRAME = [
  { id: 418, x: 65.5, y: 398.7, lng: -0.14255404472351074, lat: 51.5232037932133 },
  { id: 257, x: 45.8, y: 476.3, lng: -0.1447749137878418, lat: 51.51288236796347 },
  { id: 161, x: 119.7, y: 471.8, lng: -0.13253331184387207, lat: 51.513456583717186 },
  { id: 609, x: 150.8, y: 534.7, lng: -0.12709379196166992, lat: 51.50571073833211 },
  { id: 513, x: 58.5, y: 523.9, lng: -0.14203906059265137, lat: 51.50700625590363 },
] as const;

describe("projectAtCamera", () => {
  it.each(ENGINE_PHONE_FRAME)("puts cluster $id where the engine drew it", ({ x, y, lng, lat }) => {
    const at = projectAtCamera(lng, lat, MAP_OPENING_PREVIEW_CAMERA, 390, 844);
    expect(at.x).toBeCloseTo(x, 0);
    expect(at.y).toBeCloseTo(y, 0);
  });

  it("refuses a camera with a bearing rather than guess at the turn", () => {
    expect(() =>
      projectAtCamera(-0.1, 51.5, { ...MAP_OPENING_PREVIEW_CAMERA, bearing: -8 }, 390, 844),
    ).toThrow(/bearing/);
  });
});

describe("openingPreviewDiscs over the shipped eager cell", () => {
  const discs = openingPreviewDiscs(coreRows);

  it("draws every cluster the engine painted, at its centre", () => {
    for (const painted of ENGINE_PHONE_FRAME) {
      const disc = discs.find((candidate) => candidate.id === painted.id);
      expect(disc, `cluster ${painted.id}`).toBeDefined();
      // The engine hands a centre back through its tile grid: a few millionths of a degree.
      expect(disc!.lng).toBeCloseTo(painted.lng, 5);
      expect(disc!.lat).toBeCloseTo(painted.lat, 5);
    }
  });

  it("prints each disc's cheapest price the way a pin writes it, cheapest first", () => {
    expect(discs.length).toBeGreaterThan(0);
    for (const disc of discs) expect(disc.figure).toBe(formatPinPriceLabel(disc.priceGbp));
    const prices = discs.map((disc) => disc.priceGbp);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("claims exactly what the map's own features cluster to", () => {
    const claims = openingDiscClaims(coreFeatures());
    expect(claims.map((c) => [c.id, c.count, c.priceGbp]).sort()).toEqual(
      discs.map((d) => [d.id, d.count, d.priceGbp]).sort(),
    );
  });
});

describe("frameMatchesPreview", () => {
  const discs = openingPreviewDiscs(coreRows);
  const frame = (over: Partial<MapOpeningFrame> = {}): MapOpeningFrame => ({
    features: coreFeatures(),
    camera: { ...MAP_OPENING_PREVIEW_CAMERA },
    ...over,
  });

  it("accepts the frame the preview was drawn from", () => {
    expect(frameMatchesPreview(frame(), discs)).toBe(true);
  });

  it("accepts a source with no pubs yet, which contradicts nothing", () => {
    expect(frameMatchesPreview(frame({ features: [] }), discs)).toBe(true);
  });

  it("refuses a camera that has moved", () => {
    expect(
      frameMatchesPreview(
        frame({ camera: { ...MAP_OPENING_PREVIEW_CAMERA, center: [-0.09, 51.51] } }),
        discs,
      ),
    ).toBe(false);
    expect(frameMatchesPreview(frame({ camera: { ...MAP_OPENING_PREVIEW_CAMERA, zoom: 14 } }), discs)).toBe(false);
  });

  it("refuses a frame where a drinker's lower price changed a disc's figure", () => {
    const features = coreFeatures();
    const disc = discs[discs.length - 1]!;
    // Lower the dearest disc's cheapest pub below every other figure.
    const member = features.find(
      (feature) =>
        typeof feature.properties?.clusterPrice === "number" &&
        Math.round(feature.properties.clusterPrice * 100) === Math.round(disc.priceGbp * 100),
    );
    expect(member).toBeDefined();
    member!.properties = { ...member!.properties, clusterPrice: 1.5 };
    expect(frameMatchesPreview(frame({ features }), discs)).toBe(false);
  });

  it("refuses a frame with a pub more or fewer", () => {
    expect(frameMatchesPreview(frame({ features: coreFeatures().slice(1) }), discs)).toBe(false);
  });
});
