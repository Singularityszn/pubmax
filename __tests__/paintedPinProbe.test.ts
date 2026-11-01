import { afterEach, describe, expect, it, vi } from "vitest";
import { wireClickRouting } from "@/components/map/canvas/interactions";
import type * as maplibregl from "maplibre-gl";

import {
  installPaintedPinProbe,
  paintedLondonPlaceTapPoints,
  paintedMapTapPoints,
} from "@/components/map/canvas/paintedPinProbe";

describe("passive painted map loading observation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function install({
    style = { sources: { z: {}, a: {}, unknown: {} } },
    loaded = false,
    styleLoaded = false,
    tilesLoaded = true,
  }: {
    style?: { sources: Record<string, unknown> } | null;
    loaded?: boolean;
    styleLoaded?: boolean | undefined;
    tilesLoaded?: boolean;
  } = {}) {
    const probeWindow: {
      __pubmaxPaintedMapTapPoints?: (() => unknown[]) & { state?: () => {
        at: number;
        loaded: boolean;
        styleLoaded: boolean | null;
        tilesLoaded: boolean | null;
        sourceLoaded: Record<string, boolean | null>;
      } };
      __pubmaxPaintedLondonPlaceTapPoints?: () => unknown[];
    } = {};
    vi.stubGlobal("window", probeWindow);
    const forbiddenWork = vi.fn(() => { throw new Error("Observation must remain passive"); });
    for (const name of ["fetch", "setTimeout", "setInterval", "requestAnimationFrame"]) {
      vi.stubGlobal(name, forbiddenWork);
    }
    const reads = {
      getStyle: vi.fn(() => style),
      loaded: vi.fn(() => loaded),
      isStyleLoaded: vi.fn((): boolean | undefined => styleLoaded),
      areTilesLoaded: vi.fn(() => tilesLoaded),
      isSourceLoaded: vi.fn((id: string) => new Map([["a", false], ["z", true]]).get(id)),
    };
    // Any feature query, mutation or listener operation fails through this map.
    const map = new Proxy(reads, {
      get: (target, name) => Reflect.get(target, name) ?? forbiddenWork,
    }) as unknown as maplibregl.Map;
    const cleanup = installPaintedPinProbe(map);
    return { probeWindow, reads, cleanup, forbiddenWork };
  }

  it("installs lazily, reads independent loading facts and removes both probes", () => {
    vi.spyOn(performance, "now").mockReturnValue(123);
    const { probeWindow, reads, cleanup, forbiddenWork } = install();
    try {
      expect(typeof probeWindow.__pubmaxPaintedMapTapPoints).toBe("function");
      expect(typeof probeWindow.__pubmaxPaintedLondonPlaceTapPoints).toBe("function");
      for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
      expect(probeWindow.__pubmaxPaintedMapTapPoints?.state?.()).toEqual({
        at: 123,
        loaded: false,
        styleLoaded: false,
        tilesLoaded: true,
        sourceLoaded: { a: false, unknown: null, z: true },
      });
      expect(reads.isSourceLoaded.mock.calls).toEqual([["a"], ["unknown"], ["z"]]);
      for (const read of [reads.getStyle, reads.loaded, reads.isStyleLoaded, reads.areTilesLoaded]) {
        expect(read).toHaveBeenCalledTimes(1);
      }
      expect(forbiddenWork).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
    expect(probeWindow).toEqual({});
    expect(forbiddenWork).not.toHaveBeenCalled();
  });

  it("keeps style, tiles and source facts independent of loaded", () => {
    const { probeWindow, cleanup, forbiddenWork } = install({
      loaded: true, styleLoaded: true, tilesLoaded: false,
    });
    try {
      const state = probeWindow.__pubmaxPaintedMapTapPoints?.state?.();
      expect(state).toMatchObject({
        loaded: true, styleLoaded: true, tilesLoaded: false,
        sourceLoaded: { a: false, unknown: null, z: true },
      });
      expect(Object.keys(state!.sourceLoaded)).toEqual(["a", "unknown", "z"]);
      expect(forbiddenWork).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("reports unavailable style facts without asking unsafe loading methods", () => {
    const { probeWindow, reads, cleanup, forbiddenWork } = install({ style: null });
    try {
      expect(probeWindow.__pubmaxPaintedMapTapPoints?.state?.()).toMatchObject({
        loaded: false, styleLoaded: null, tilesLoaded: null, sourceLoaded: {},
      });
      for (const read of [reads.isStyleLoaded, reads.areTilesLoaded, reads.isSourceLoaded]) {
        expect(read).not.toHaveBeenCalled();
      }
      expect(forbiddenWork).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("reports an unavailable style-loaded answer as null", () => {
    const { probeWindow, reads, cleanup } = install();
    reads.isStyleLoaded.mockReturnValue(undefined);
    try {
      expect(probeWindow.__pubmaxPaintedMapTapPoints?.state?.()).toMatchObject({
        styleLoaded: null, tilesLoaded: true,
      });
    } finally {
      cleanup();
    }
  });
});

// The probe exists so a browser test taps a mark that is really there. Each
// gate below is one way a canvas can lie about that, so each is pinned apart.

type FakeMark = {
  layer: string;
  id: string;
  lng: number;
  lat: number;
  x: number;
  y: number;
  properties?: Record<string, unknown>;
};

type FakeMapOptions = {
  /** Marks the viewport query reports as painted. */
  painted: FakeMark[];
  /** Ids a point query re-confirms. Defaults to every painted id. */
  confirmed?: string[];
  /** Ordered point-query hits, including overlapping marks when supplied. */
  pointHits?: FakeMark[];
  captureClick?: (handler: (event: { point: { x: number; y: number } }) => void) => void;
  /** Ids whose viewport point is covered by other chrome. */
  covered?: string[];
  layers?: string[];
  rect?: { left: number; top: number; width: number; height: number };
  zoom?: number;
  loaded?: boolean;
};

function makeMap(options: FakeMapOptions): maplibregl.Map {
  const {
    painted,
    confirmed = painted.map((mark) => mark.id),
    pointHits,
    captureClick,
    covered = [],
    layers = ["pubs-point", "clusters"],
    rect = { left: 0, top: 0, width: 390, height: 844 },
    zoom = 14,
    loaded = true,
  } = options;

  const canvas = { nodeName: "CANVAS" } as unknown as HTMLCanvasElement;
  const chromeButton = { nodeName: "BUTTON" } as unknown as HTMLElement;
  const container = {
    getBoundingClientRect: () => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
    }),
    contains: () => false,
    ownerDocument: {
      defaultView: {
        Element: class {} as typeof Element,
        getComputedStyle: (element: unknown) => ({
          pointerEvents:
            element === chromeButton ? "auto" : "auto",
        }),
      },
      elementsFromPoint: (x: number, y: number) => {
        const mark = painted.find(
          (item) => item.x === x - rect.left && item.y === y - rect.top,
        );
        if (mark && covered.includes(mark.id)) return [chromeButton];
        return [canvas];
      },
    },
  };

  const feature = (mark: FakeMark) => ({
    layer: { id: mark.layer },
    properties: mark.layer === "clusters"
      ? { cluster_id: Number(mark.id) }
      : { id: mark.id, name: "A pub", ...mark.properties },
    geometry: { type: "Point", coordinates: [mark.lng, mark.lat] },
  });

  return {
    on: (event: string, handler: (event: { point: { x: number; y: number } }) => void) => {
      if (event === "click") captureClick?.(handler);
    },
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    getContainer: () => container,
    getCanvas: () => canvas,
    getZoom: () => zoom,
    loaded: () => loaded,
    getSource: () => ({ getClusterExpansionZoom: vi.fn(async () => 14) }),
    project: ([lng, lat]: [number, number]) => {
      const mark = painted.find((item) => item.lng === lng && item.lat === lat);
      return { x: mark?.x ?? -1, y: mark?.y ?? -1 };
    },
    queryRenderedFeatures: (
      pointOrOptions?: unknown,
      pointOptions?: { layers?: string[] },
    ) => {
      const point = pointOrOptions as
        | { x?: number; y?: number; layers?: string[] }
        | undefined;
      const wanted = new Set(
        (typeof point?.x === "number"
          ? pointOptions?.layers
          : point?.layers) ?? layers,
      );
      const inLayer = painted.filter((mark) => wanted.has(mark.layer));
      if (typeof point?.x === "number" && typeof point?.y === "number") {
        if (pointHits) return pointHits.filter((mark) => wanted.has(mark.layer)).map(feature);
        const mark = inLayer.find(
          (item) => item.x === point.x && item.y === point.y,
        );
        return mark && confirmed.includes(mark.id) ? [feature(mark)] : [];
      }
      return inLayer.map(feature);
    },
  } as unknown as maplibregl.Map;
}

const PIN_A: FakeMark = {
  layer: "pubs-point",
  id: "pub-a",
  lng: -0.1,
  lat: 51.5,
  x: 120,
  y: 400,
};
const PIN_B: FakeMark = {
  layer: "pubs-point",
  id: "pub-b",
  lng: -0.2,
  lat: 51.6,
  x: 220,
  y: 500,
};
const CLUSTER: FakeMark = {
  layer: "clusters",
  id: "77",
  lng: -0.3,
  lat: 51.7,
  x: 180,
  y: 300,
};

describe("paintedMapTapPoints", () => {
  it("publishes no tap target while source and style updates are pending", () => {
    const map = makeMap({ painted: [PIN_A, CLUSTER], loaded: false });
    expect(paintedMapTapPoints(map)).toEqual([]);
    vi.spyOn(map, "loaded").mockReturnValue(true);
    expect(paintedMapTapPoints(map).map((point) => point.id)).toEqual(["pub-a", "77"]);
  });

  it.each([
    ["same-layer first hit", "pubs-point", "pubs-point", false],
    ["ordinary pub over selected pub", "pubs-point-selected", "pubs-point", true],
    ["price pill over ordinary pub", "pubs-point", "pubs-price-pill", true],
    ["ordinary pill over the selected pill", "pubs-price-pill-selected", "pubs-price-pill", true],
  ] as const)("omits a nonwinning point: %s", (_name, losingLayer, winningLayer, loserFirst) => {
    const loser = { ...PIN_A, layer: losingLayer };
    const winner = { ...PIN_B, layer: winningLayer };
    const background = { ...PIN_A, layer: "landmarks-icon", id: "background" };
    let click: ((event: { point: { x: number; y: number } }) => void) | undefined;
    const map = makeMap({
      painted: [loser, winner],
      layers: [losingLayer, winningLayer, "clusters", "landmarks-icon"],
      pointHits: [CLUSTER, background, ...(loserFirst ? [loser, winner] : [winner, loser])],
      captureClick: (handler) => { click = handler; },
    });
    const points = paintedMapTapPoints(map);
    expect(points).toEqual([
      { kind: "pin", id: winner.id, x: winner.x, y: winner.y, lng: winner.lng, lat: winner.lat },
    ]);
    // Exercise the actual event router with the same ordered hit stack.
    // Cluster and landmark hits come first in that stack but must not win.
    const onVenueClick = vi.fn();
    wireClickRouting(map, {
      selectLandmark: vi.fn(),
      setHoveredVenue: vi.fn(),
      setActivePoi: vi.fn(),
      onVenueClickRef: { current: onVenueClick },
      onUkBasePubClickRef: { current: vi.fn() },
      onRouteStopClickRef: { current: vi.fn() },
      onTonightOpportunityClickRef: { current: vi.fn() },
      cityLandmarksRef: { current: [] },
      tonightOpportunitiesRef: { current: [] },
      cinematic: vi.fn(),
    });
    for (const point of points) click?.({ point: { x: point.x, y: point.y } });
    expect(onVenueClick.mock.calls.map(([id]) => id)).toEqual(points.map((point) => point.id));
  });

  it("answers with the viewport point of each painted mark", () => {
    const points = paintedMapTapPoints(
      makeMap({ painted: [PIN_A, PIN_B, CLUSTER] }),
    );
    expect(points).toEqual([
      { kind: "pin", id: "pub-a", x: 120, y: 400, lng: -0.1, lat: 51.5 },
      { kind: "pin", id: "pub-b", x: 220, y: 500, lng: -0.2, lat: 51.6 },
      { kind: "cluster", id: "77", x: 180, y: 300, lng: -0.3, lat: 51.7 },
    ]);
  });

  it("answers the selected pub's inverted pill as a tappable pin", () => {
    const selected = { ...PIN_A, layer: "pubs-price-pill-selected" };
    const map = makeMap({ painted: [selected], layers: ["pubs-price-pill-selected", "clusters"] });
    expect(paintedMapTapPoints(map)).toEqual([
      { kind: "pin", id: "pub-a", x: 120, y: 400, lng: -0.1, lat: 51.5 },
    ]);
  });

  it("puts pins before clusters, so a caller takes the shorter way in", () => {
    const points = paintedMapTapPoints(makeMap({ painted: [CLUSTER, PIN_A] }));
    expect(points.map((point) => point.kind)).toEqual(["pin", "cluster"]);
  });

  it("checks overview clusters before expensive symbol placement", () => {
    const points = paintedMapTapPoints(
      makeMap({ painted: [CLUSTER, PIN_A], zoom: 10.7 }),
    );
    expect(points).toEqual([
      { kind: "cluster", id: "77", x: 180, y: 300, lng: -0.3, lat: 51.7 },
    ]);
  });

  it("carries the container offset, so a tap lands where the map draws", () => {
    const points = paintedMapTapPoints(
      makeMap({
        painted: [PIN_A],
        rect: { left: 8, top: 60, width: 374, height: 700 },
      }),
    );
    expect(points).toEqual([
      { kind: "pin", id: "pub-a", x: 128, y: 460, lng: -0.1, lat: 51.5 },
    ]);
  });

  it("drops a mark whose own point does not re-query to it", () => {
    // A tap there would resolve to something else, so it is not this mark's tap.
    const points = paintedMapTapPoints(
      makeMap({ painted: [PIN_A, PIN_B], confirmed: ["pub-b"] }),
    );
    expect(points).toEqual([
      { kind: "pin", id: "pub-b", x: 220, y: 500, lng: -0.2, lat: 51.6 },
    ]);
  });

  it("drops a mark the app chrome covers", () => {
    // The topbar would receive that tap, not the map.
    const points = paintedMapTapPoints(
      makeMap({ painted: [PIN_A, PIN_B], covered: ["pub-a"] }),
    );
    expect(points).toEqual([
      { kind: "pin", id: "pub-b", x: 220, y: 500, lng: -0.2, lat: 51.6 },
    ]);
  });

  it("answers with nothing before the pub layers exist", () => {
    expect(paintedMapTapPoints(makeMap({ painted: [PIN_A], layers: [] })))
      .toEqual([]);
  });

  it("answers with nothing when the map paints no pub mark", () => {
    expect(paintedMapTapPoints(makeMap({ painted: [] }))).toEqual([]);
  });

  it("includes UK base pin layers when they are on the map", () => {
    const ukPin: FakeMark = {
      layer: "uk-base-point",
      id: "venue-uk-1",
      lng: -0.15,
      lat: 51.52,
      x: 140,
      y: 420,
    };
    const points = paintedMapTapPoints(
      makeMap({
        painted: [ukPin],
        layers: ["uk-base-point", "uk-base-selected", "pubs-point", "clusters"],
      }),
    );
    expect(points).toEqual([
      {
        kind: "pin",
        id: "venue-uk-1",
        x: 140,
        y: 420,
        lng: -0.15,
        lat: 51.52,
      },
    ]);
  });

  // A gesture moves where a mark is DRAWN and may never move where it IS, so a
  // spec needs both halves to hold one against the other across a rotation.
  it("carries where the mark is, beside where it is being drawn", () => {
    const [point] = paintedMapTapPoints(makeMap({ painted: [PIN_A] }));
    expect(point).toMatchObject({ lng: PIN_A.lng, lat: PIN_A.lat });
  });
});

describe("painted target and real click routing parity", () => {
  const pub = { ...PIN_A, layer: "pubs-point-selected" };
  const base = { ...PIN_A, layer: "uk-base-point", id: "venue-uk-n1" };
  const unnamed = { ...base, layer: "uk-base-unnamed-point", id: "venue-uk-n2", properties: { unnamed: true } };
  const cafe = { ...PIN_A, layer: "coffee-pilot-point", id: "venue-osm-n3" };
  const restaurant = { ...PIN_A, layer: "london-restaurant-point", id: "venue-osm-n4" };
  const route = { ...PIN_A, layer: "route-stops", id: "route-pub" };
  const cluster = { ...CLUSTER, x: PIN_A.x, y: PIN_A.y };
  const tonight = { ...PIN_A, layer: "tonight-point", id: "tonight-1" };
  const landmark = { ...PIN_A, layer: "landmarks-label", id: "landmark-1" };
  const poi = { ...PIN_A, layer: "pois-dot", id: "poi-1" };

  it.each([
    { name: "restaurant beneath selected pub", hits: [restaurant, pub], winner: pub, kind: "venue", pubs: [pub], places: [] },
    { name: "selected UK circle without a symbol", hits: [{ ...base, layer: "uk-base-selected" }], winner: null, kind: null, pubs: [], places: [] },
    { name: "cafe before UK base", hits: [base, cafe], winner: cafe, kind: "venue", pubs: [], places: [cafe] },
    { name: "UK base before restaurant", hits: [restaurant, base], winner: base, kind: "base", pubs: [base], places: [] },
    { name: "named UK before unnamed UK", hits: [unnamed, base], winner: base, kind: "base", pubs: [base], places: [] },
    { name: "unnamed UK before restaurant", hits: [restaurant, unnamed], winner: unnamed, kind: "base", pubs: [unnamed], places: [] },
    { name: "first UK hit within one layer", hits: [base, { ...base, id: "venue-uk-n5" }], winner: base, kind: "base", pubs: [base], places: [] },
    { name: "first cafe hit within one layer", hits: [cafe, { ...cafe, id: "venue-osm-n6" }], winner: cafe, kind: "venue", pubs: [], places: [cafe] },
    { name: "first restaurant hit within one layer", hits: [restaurant, { ...restaurant, id: "venue-osm-n7" }], winner: restaurant, kind: "venue", pubs: [], places: [restaurant] },
    { name: "pub before cluster", hits: [cluster, pub], winner: pub, kind: "venue", pubs: [pub], places: [] },
    { name: "route before cluster and cafe", hits: [cafe, cluster, route], winner: route, kind: "route", pubs: [], places: [] },
    { name: "cluster before cafe and UK and restaurant", hits: [restaurant, base, cafe, cluster], winner: cluster, kind: "cluster", pubs: [cluster], places: [] },
    { name: "UK before tonight and landmark and POI", hits: [poi, landmark, tonight, base], winner: base, kind: "base", pubs: [base], places: [] },
    { name: "invalid first cafe blocks later restaurant", hits: [{ ...cafe, id: "invalid-cafe" }, restaurant], winner: null, kind: null, pubs: [], places: [] },
    { name: "invalid first base blocks restaurant", hits: [{ ...base, properties: { name: "" } }, restaurant], winner: null, kind: null, pubs: [], places: [] },
  ])("returns only the actual target: $name", async ({ hits, winner, kind, pubs, places }) => {
    let click: ((event: { point: { x: number; y: number } }) => void) | undefined;
    const map = makeMap({
      painted: hits,
      pointHits: hits,
      layers: [...new Set(hits.map((hit) => hit.layer))],
      captureClick: (handler) => { click = handler; },
    });
    const opened: { kind: string; id: string }[] = [];
    wireClickRouting(map, {
      selectLandmark: vi.fn(),
      setHoveredVenue: vi.fn(),
      setActivePoi: vi.fn(),
      onVenueClickRef: { current: (id) => { opened.push({ kind: "venue", id }); } },
      onUkBasePubClickRef: { current: (pub) => { opened.push({ kind: "base", id: pub.id }); } },
      onRouteStopClickRef: { current: (id) => { opened.push({ kind: "route", id }); } },
      onTonightOpportunityClickRef: { current: vi.fn() },
      cityLandmarksRef: { current: [] },
      tonightOpportunitiesRef: { current: [] },
      cinematic: () => { opened.push({ kind: "cluster", id: cluster.id }); },
    });
    click!({ point: { x: PIN_A.x, y: PIN_A.y } });
    await Promise.resolve();
    expect(opened).toEqual(winner ? [{ kind, id: winner.id }] : []);
    const pointFor = (mark: FakeMark) => ({
      kind: mark.layer === "clusters" ? "cluster" : "pin",
      id: mark.id, x: mark.x, y: mark.y, lng: mark.lng, lat: mark.lat,
    });
    expect(paintedMapTapPoints(map)).toEqual(pubs.map(pointFor));
    expect(paintedLondonPlaceTapPoints(map)).toEqual(places.map(pointFor));
  });
});

describe("paintedLondonPlaceTapPoints", () => {
  const restaurant: FakeMark = {
    layer: "london-restaurant-point",
    id: "venue-osm-n25496840",
    lng: -0.11,
    lat: 51.517,
    x: 160,
    y: 440,
  };
  const layers = ["london-restaurant-point", "coffee-pilot-point", "pubs-point", "clusters"];

  it("answers the painted London restaurants and never a pub or a cluster", () => {
    const points = paintedLondonPlaceTapPoints(
      makeMap({ painted: [restaurant, PIN_A, CLUSTER], layers }),
    );
    expect(points).toEqual([
      { kind: "pin", id: restaurant.id, x: 160, y: 440, lng: -0.11, lat: 51.517 },
    ]);
  });

  it("keeps London places out of the pub answer every map spec reads", () => {
    const points = paintedMapTapPoints(makeMap({ painted: [restaurant, PIN_A], layers }));
    expect(points.map((point) => point.id)).toEqual(["pub-a"]);
  });
});
