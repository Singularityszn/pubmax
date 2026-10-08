// The Shoreditch coffee lens: the committed pilot rows joined to the London
// venue layer, drawn as their own cafe dots under the coffee lane and opened
// into their own sheet. Each drink stays its own fact with its own page and
// day, and nothing the pilot holds reaches a pint surface.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type * as maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { buildCoffeePilot, type SceneCtx } from "@/components/map/canvas/buildScene";
import { PIN_PRICE_LABEL_MIN_ZOOM } from "@/components/map/canvas/filters";
import { PUB_FIRST_LAYERS } from "@/components/map/canvas/interactions";
import { OSM_ATTRIBUTION, type Tokens } from "@/components/map/canvas/tokens";
import {
  coffeePilotCafes,
  coffeePilotDay,
  coffeePilotPinLabel,
  coffeePilotShards,
  coffeePilotSourceLine,
  coffeePilotToGeoJSON,
  type CoffeePilotCafe,
  type CoffeePilotRow,
} from "@/lib/coffeePilot";
import { LONDON_VENUE_MANIFEST_PATH, loadCoffeePilotCafes } from "@/lib/coffeePilotLoader";
import { parseLondonVenueManifest, type LondonVenue } from "@/lib/londonVenueShards";
import { COFFEE_PILOT_FILE } from "../scripts/lib/coffeePilotRows.mjs";

const ROOT = resolve(__dirname, "..");
const pilotFile = JSON.parse(readFileSync(join(ROOT, COFFEE_PILOT_FILE), "utf8")) as {
  rows: { venueId: string; venueName: string; drink: string; priceGbp: number; sourceUrl: string; observedAt: string }[];
};

/** Serves `public/` the way the browser would, so the loader reads the real packs. */
function publicFetch(fail?: (url: string) => boolean): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (fail?.(url)) return new Response("nope", { status: 503 });
    const body = readFileSync(join(ROOT, "public", url.replace(/^\//, "")), "utf8");
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const cafe = (overrides: Partial<LondonVenue> = {}): LondonVenue => ({
  id: "venue-osm-n1",
  name: "Example Cafe",
  address: "1 Example Street",
  lat: 51.525,
  lng: -0.077,
  kind: "cafe",
  ...overrides,
});

const row = (overrides: Partial<CoffeePilotRow> = {}): CoffeePilotRow => ({
  venueId: "venue-osm-n1",
  drink: "flat white",
  priceGbp: 3.4,
  sourceUrl: "https://example.test/menu",
  observedAt: "2026-10-03",
  ...overrides,
});

describe("coffee pilot cafes", () => {
  it("keeps three drinks as three facts, in menu order", () => {
    const [joined] = coffeePilotCafes(
      [
        row({ drink: "matcha latte", priceGbp: 4.5 }),
        row({ drink: "latte", priceGbp: 3.8 }),
        row({ drink: "flat white", priceGbp: 3.7 }),
      ],
      [cafe()],
    );
    if (!joined) throw new Error("no cafe joined");
    expect(joined.prices.map((price) => [price.drink, price.priceGbp])).toEqual([
      ["flat white", 3.7],
      ["latte", 3.8],
      ["matcha latte", 4.5],
    ]);
  });

  it("draws only a row the layer places as a cafe", () => {
    const joined = coffeePilotCafes(
      [row(), row({ venueId: "venue-osm-n2" }), row({ venueId: "venue-osm-n3" })],
      [cafe(), cafe({ id: "venue-osm-n2", kind: "bar" })],
    );
    expect(joined.map((item) => item.id)).toEqual(["venue-osm-n1"]);
  });

  it("names the drink on the pin, and an absent flat white is never borrowed", () => {
    const [onlyMatcha] = coffeePilotCafes([row({ drink: "matcha latte", priceGbp: 5.5 })], [cafe()]);
    if (!onlyMatcha) throw new Error("no cafe joined");
    expect(coffeePilotPinLabel(onlyMatcha)).toBe("£5.50 matcha latte");
    expect(onlyMatcha.prices.map((price) => price.drink)).toEqual(["matcha latte"]);
    const empty: CoffeePilotCafe = { ...onlyMatcha, prices: [] };
    expect(coffeePilotPinLabel(empty)).toBeNull();
    expect(coffeePilotToGeoJSON([empty]).features).toEqual([]);
  });

  it("says where and when each price was listed", () => {
    expect(coffeePilotDay("2026-10-03")).toBe("3 October 2026");
    expect(
      coffeePilotSourceLine({
        drink: "latte",
        priceGbp: 3.8,
        sourceUrl: "https://www.crosstown.co.uk/project/latte/",
        observedAt: "2026-10-03",
      }),
    ).toBe("Listed on crosstown.co.uk, 3 October 2026");
  });

  it("reads only the London shards that overlap the pilot box", () => {
    const manifest = parseLondonVenueManifest(
      JSON.parse(readFileSync(join(ROOT, "public", LONDON_VENUE_MANIFEST_PATH), "utf8")),
    );
    expect(manifest).not.toBeNull();
    const shards = coffeePilotShards(manifest!.shards);
    expect(shards.length).toBeGreaterThan(0);
    expect(shards.length).toBeLessThan(manifest!.shards.length);
  });
});

describe("loadCoffeePilotCafes", () => {
  it("places every committed cafe with every committed price", async () => {
    const cafes = await loadCoffeePilotCafes(publicFetch());
    const venueIds = new Set(pilotFile.rows.map((item) => item.venueId));
    expect(cafes.map((item) => item.id).sort()).toEqual([...venueIds].sort());
    for (const item of pilotFile.rows) {
      const placed = cafes.find((candidate) => candidate.id === item.venueId)!;
      expect(placed.name).toBe(item.venueName);
      expect(placed.prices).toContainEqual({
        drink: item.drink,
        priceGbp: item.priceGbp,
        sourceUrl: item.sourceUrl,
        observedAt: item.observedAt,
      });
    }
    const points = coffeePilotToGeoJSON(cafes);
    expect(points.features).toHaveLength(cafes.length);
    for (const feature of points.features) {
      expect(feature.properties?.label).toMatch(/^£\d+\.\d{2} (flat white|latte|matcha latte)$/);
    }
    const vintage = points.features.find((feature) => feature.properties?.id === "venue-osm-n12110401801");
    expect(vintage?.properties?.label).toBe("£3.45 flat white");
    expect(vintage?.properties).not.toHaveProperty("bucket");
    expect(vintage?.properties).not.toHaveProperty("clusterPrice");
  });

  it("rejects when the layer cannot be read, rather than drawing no cafes", async () => {
    await expect(loadCoffeePilotCafes(publicFetch((url) => url === LONDON_VENUE_MANIFEST_PATH))).rejects.toThrow();
    await expect(loadCoffeePilotCafes(publicFetch((url) => url.includes("/packs/")))).rejects.toThrow();
  });
});

describe("the coffee pilot layer", () => {
  function build() {
    const layers = new Map<
      string,
      { id: string; type?: string; minzoom?: number; layout?: Record<string, unknown>; paint?: Record<string, unknown> }
    >();
    const sources = new Map<string, Record<string, unknown>>();
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, spec: Record<string, unknown>) => sources.set(id, spec),
      getLayer: (id: string) => layers.get(id),
    } as unknown as maplibregl.Map;
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    buildCoffeePilot({
      map,
      tokens: new Proxy({}, { get: () => "#000000" }) as unknown as Tokens,
      dark: false,
      textFont: ["Noto Sans Regular"],
      addLayerOnce: ((layer: maplibregl.AddLayerObject) => {
        if (!layers.has(layer.id)) layers.set(layer.id, layer as never);
      }) as SceneCtx["addLayerOnce"],
      poiHidden: {} as SceneCtx["poiHidden"],
      transitLinesPath: null,
      showLandmarks: true,
      landmarksGeoJSON: empty,
      poisData: empty,
      routeLine: empty,
      routeStops: empty,
      bandCorridor: empty,
      bandColor: "#000000",
      bandMemberIds: [],
      pubsData: empty,
      userLocationData: empty,
      ukBaseData: empty,
      tonightData: empty,
      tonightVisible: false,
      coffeePilotData: empty,
      londonRestaurantData: empty,
      selectedId: "",
      selectionMuteStore: new Map<string, unknown>(),
    } satisfies SceneCtx);
    return { layers, sources };
  }

  it("credits OpenStreetMap on its own source", () => {
    expect(build().sources.get("coffee-pilot")?.attribution).toBe(OSM_ATTRIBUTION);
  });

  it("puts every cafe in the collision index rather than stacking dots", () => {
    const { layers } = build();
    const pin = layers.get("coffee-pilot-point")!;
    expect(pin.type).toBe("symbol");
    expect(pin.layout?.["icon-image"]).toBe("base:coffee");
    expect(pin.layout?.["icon-allow-overlap"]).toBe(false);
    expect(pin.layout?.["icon-ignore-placement"]).toBe(false);
    expect(pin.layout?.["text-allow-overlap"]).toBe(false);
    expect(pin.layout?.["text-ignore-placement"]).toBe(false);
    // Where the tag will not fit, the TAG goes and the cafe stays.
    expect(pin.layout?.["text-optional"]).toBe(true);
    expect(layers.has("coffee-pilot-label")).toBe(false);
  });

  it("prints the named figure from the price tag zoom and paints no price band", () => {
    const pin = build().layers.get("coffee-pilot-point")!;
    expect(pin.layout?.["text-field"]).toEqual([
      "step",
      ["zoom"],
      "",
      PIN_PRICE_LABEL_MIN_ZOOM,
      ["get", "label"],
    ]);
    expect(JSON.stringify(pin)).not.toMatch(/priceBucket|band/);
  });

  it("answers a tap after the pub pins and before the UK base layer", () => {
    const order = [...PUB_FIRST_LAYERS] as string[];
    expect(order.indexOf("coffee-pilot-point")).toBeGreaterThan(order.indexOf("pubs-point"));
    expect(order.indexOf("coffee-pilot-point")).toBeLessThan(order.indexOf("uk-base-point"));
  });
});
