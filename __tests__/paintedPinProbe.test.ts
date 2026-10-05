import { describe, expect, it } from "vitest";
import type * as maplibregl from "maplibre-gl";

import {
  paintedLondonPlaceTapPoints,
  paintedMapTapPoints,
} from "@/components/map/canvas/paintedPinProbe";

// The probe exists so a browser test taps a mark that is really there. Each
// gate below is one way a canvas can lie about that, so each is pinned apart.

type FakeMark = {
  layer: string;
  id: string;
  lng: number;
  lat: number;
  x: number;
  y: number;
};

type FakeMapOptions = {
  /** Marks the viewport query reports as painted. */
  painted: FakeMark[];
  /** Ids a point query re-confirms. Defaults to every painted id. */
  confirmed?: string[];
  /** Ids whose viewport point is covered by other chrome. */
  covered?: string[];
  layers?: string[];
  rect?: { left: number; top: number; width: number; height: number };
  zoom?: number;
};

function makeMap(options: FakeMapOptions): maplibregl.Map {
  const {
    painted,
    confirmed = painted.map((mark) => mark.id),
    covered = [],
    layers = ["pubs-point", "clusters"],
    rect = { left: 0, top: 0, width: 390, height: 844 },
    zoom = 14,
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
    properties: mark.layer === "clusters"
      ? { cluster_id: Number(mark.id) }
      : { id: mark.id },
    geometry: { type: "Point", coordinates: [mark.lng, mark.lat] },
  });

  return {
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    getContainer: () => container,
    getCanvas: () => canvas,
    getZoom: () => zoom,
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
