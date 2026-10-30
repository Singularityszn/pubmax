import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS_PX } from "@/components/map/canvas/buildScene";
import { CLUSTER_PRICE_KEY_NONE, CLUSTER_PRICE_NONE } from "@/components/map/canvas/filters";
import { formatPinPriceLabel, pubsToGeoJSON } from "@/components/map/canvas/geojson";
import { getCity } from "@/lib/cities";
import { MAP_ARRIVAL_BEARING_DEG } from "@/lib/mapArrivalBearing";
import {
  clusterAtZoom,
  frameMatchesPreview,
  MAP_OPENING_PREVIEW_CAMERA,
  OPENING_CLUSTER_MAX_ZOOM,
  OPENING_CLUSTER_PRICE_KEY_NONE,
  OPENING_CLUSTER_PRICE_NONE,
  OPENING_CLUSTER_RADIUS_PX,
  openingDiscClaims,
  openingTurnBearing,
  projectAtCamera,
  type MapOpeningFrame,
} from "@/lib/mapOpeningPreview";
import { MAP_EAGER_VENUE_INDEX_FILE } from "@/lib/mapEagerVenueIndexFile.mjs";
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
    expect(OPENING_CLUSTER_PRICE_KEY_NONE).toBe(CLUSTER_PRICE_KEY_NONE);
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

// Measured on 2026-10-21 from maplibre-gl 6.14 itself: the clusters a cold first visit's
// phone painted at the moment its pins were revealed (390 x 844, through the
// app's own painted-pin probe), with their positions on screen. The engine's
// ids, centres and placement are the ground truth the build has to meet.
// Receipt: docs/proof/map-opening-20261021/engine-phone-frame.json.
const ENGINE_PHONE_FRAME = [
  { id: 402, x: 66.2, y: 399.5, lng: -0.14241456985473633, lat: 51.52309698578392 },
  { id: 241, x: 50.3, y: 471.0, lng: -0.14410972595214844, lat: 51.51355006001529 },
  { id: 145, x: 119.8, y: 471.3, lng: -0.13253331184387207, lat: 51.51350999876814 },
  { id: 2194, x: 126.5, y: 578.8, lng: -0.1307201385498047, lat: 51.50061512375089 },
  { id: 593, x: 150.6, y: 535.6, lng: -0.12711524963378906, lat: 51.50560388987785 },
  { id: 497, x: 59.1, y: 524.7, lng: -0.14193177223205566, lat: 51.50690608833315 },
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

describe("the build-time read", () => {
  it("opens the eager cell by a literal path Next can trace", () => {
    const source = readFileSync(join(process.cwd(), "lib/mapOpeningPreview.server.ts"), "utf8");
    const literal = MAP_EAGER_VENUE_INDEX_FILE.split("/")
      .map((segment) => `"${segment}"`)
      .join(", ");
    expect(source).toContain(`join(process.cwd(), ${literal})`);
  });
});

describe("openingPreviewDiscs over the shipped eager cell", () => {
  const discs = openingPreviewDiscs(coreRows);

  it("draws every cluster the engine painted, at its centre", () => {
    for (const painted of ENGINE_PHONE_FRAME) {
      const disc = discs.find((candidate) => candidate.id === painted.id);
      expect(disc, `cluster ${painted.id}`).toBeDefined();
      // The engine hands a centre back through its tile grid: a few millionths
      // of a degree (5.2e-6 measured on 2026-10-17), well under a pixel here.
      expect(Math.abs(disc!.lng - painted.lng)).toBeLessThan(1e-5);
      expect(Math.abs(disc!.lat - painted.lat)).toBeLessThan(1e-5);
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

  it("accepts the camera the arrival turn leaves, and nothing turned further", () => {
    const turned = (bearing: number) =>
      frame({ camera: { ...MAP_OPENING_PREVIEW_CAMERA, bearing: MAP_OPENING_PREVIEW_CAMERA.bearing + bearing } });
    expect(frameMatchesPreview(turned(MAP_ARRIVAL_BEARING_DEG), discs)).toBe(true);
    expect(frameMatchesPreview(turned(MAP_ARRIVAL_BEARING_DEG + 1), discs)).toBe(false);
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

  it("refuses a frame where a live price moved the cheapest pub to another band, which recolours its figure", () => {
    const features = coreFeatures();
    const disc = discs[0]!;
    // The cheapest disc's cheapest pub keeps its figure but changes band, so
    // the disc's id, count and price all hold and only its figure's ink differs.
    const member = features.find(
      (feature) =>
        typeof feature.properties?.clusterPrice === "number" &&
        Math.round(feature.properties.clusterPrice * 100) === Math.round(disc.priceGbp * 100),
    );
    expect(member).toBeDefined();
    const bucket = member!.properties!.bucket as number;
    member!.properties = { ...member!.properties, bucket: bucket === 2 ? 1 : 2 };
    expect(frameMatchesPreview(frame({ features }), discs)).toBe(false);
  });

  it("refuses a frame with a pub more or fewer", () => {
    expect(frameMatchesPreview(frame({ features: coreFeatures().slice(1) }), discs)).toBe(false);
  });
});

describe("openingTurnBearing", () => {
  const from = { ...MAP_OPENING_PREVIEW_CAMERA };

  it("reads a camera that only turned, as far as the arrival turn turns it", () => {
    expect(openingTurnBearing({ ...from, bearing: from.bearing + 1.5 }, from)).toBeCloseTo(from.bearing + 1.5);
    expect(openingTurnBearing({ ...from, bearing: from.bearing + MAP_ARRIVAL_BEARING_DEG }, from)).toBeCloseTo(
      from.bearing + MAP_ARRIVAL_BEARING_DEG,
    );
  });

  it("refuses a turn past the arrival turn", () => {
    expect(openingTurnBearing({ ...from, bearing: from.bearing + MAP_ARRIVAL_BEARING_DEG + 0.5 }, from)).toBeNull();
  });

  it("refuses any move that is more than a turn", () => {
    expect(openingTurnBearing({ ...from, bearing: from.bearing + 1, zoom: from.zoom + 0.1 }, from)).toBeNull();
    expect(openingTurnBearing({ ...from, bearing: from.bearing + 1, pitch: from.pitch + 1 }, from)).toBeNull();
    expect(
      openingTurnBearing({ ...from, bearing: from.bearing + 1, center: [from.center[0] + 0.001, from.center[1]] }, from),
    ).toBeNull();
  });
});
