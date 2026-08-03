import { describe, expect, it } from "vitest";
import type * as maplibregl from "maplibre-gl";

import { paintedPinTapPoints } from "@/components/map/canvas/paintedPinProbe";

// The probe exists so a browser test taps a pin that is really there. Each
// gate below is one way a canvas can lie about that, so each is pinned apart.

type FakePin = { id: string; lng: number; lat: number; x: number; y: number };

type FakeMapOptions = {
  /** Pins the viewport query reports as painted. */
  painted: FakePin[];
  /** Ids a point query re-confirms. Defaults to every painted id. */
  confirmed?: string[];
  /** Ids whose viewport point is covered by other chrome. */
  covered?: string[];
  layers?: string[];
  rect?: { left: number; top: number; width: number; height: number };
};

function makeMap(options: FakeMapOptions): maplibregl.Map {
  const {
    painted,
    confirmed = painted.map((pin) => pin.id),
    covered = [],
    layers = ["pubs-point"],
    rect = { left: 0, top: 0, width: 390, height: 844 },
  } = options;

  const canvas = { nodeName: "CANVAS" } as unknown as HTMLCanvasElement;
  const pinAtPoint = (x: number, y: number) =>
    painted.find((pin) => pin.x === x - rect.left && pin.y === y - rect.top);
  const container = {
    getBoundingClientRect: () => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
    }),
    ownerDocument: {
      elementFromPoint: (x: number, y: number) => {
        const pin = pinAtPoint(x, y);
        return pin && covered.includes(pin.id) ? { nodeName: "BUTTON" } : canvas;
      },
    },
  };

  const feature = (pin: FakePin) => ({
    properties: { id: pin.id },
    geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
  });

  return {
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    getContainer: () => container,
    getCanvas: () => canvas,
    project: ([lng, lat]: [number, number]) => {
      const pin = painted.find((item) => item.lng === lng && item.lat === lat);
      return { x: pin?.x ?? -1, y: pin?.y ?? -1 };
    },
    queryRenderedFeatures: (
      pointOrOptions?: { x: number; y: number } | unknown,
    ) => {
      const point = pointOrOptions as { x?: number; y?: number } | undefined;
      if (typeof point?.x === "number" && typeof point?.y === "number") {
        const pin = painted.find(
          (item) => item.x === point.x && item.y === point.y,
        );
        return pin && confirmed.includes(pin.id) ? [feature(pin)] : [];
      }
      return painted.map(feature);
    },
  } as unknown as maplibregl.Map;
}

const PIN_A: FakePin = { id: "pub-a", lng: -0.1, lat: 51.5, x: 120, y: 400 };
const PIN_B: FakePin = { id: "pub-b", lng: -0.2, lat: 51.6, x: 220, y: 500 };

describe("paintedPinTapPoints", () => {
  it("answers with the viewport point of each painted pin", () => {
    const points = paintedPinTapPoints(makeMap({ painted: [PIN_A, PIN_B] }));
    expect(points).toEqual([
      { id: "pub-a", x: 120, y: 400 },
      { id: "pub-b", x: 220, y: 500 },
    ]);
  });

  it("carries the container offset, so a tap lands where the map draws", () => {
    const points = paintedPinTapPoints(
      makeMap({
        painted: [PIN_A],
        rect: { left: 8, top: 60, width: 374, height: 700 },
      }),
    );
    expect(points).toEqual([{ id: "pub-a", x: 128, y: 460 }]);
  });

  it("drops a pin whose own point does not re-query to it", () => {
    // A tap there would resolve to something else, so it is not this pin's tap.
    const points = paintedPinTapPoints(
      makeMap({ painted: [PIN_A, PIN_B], confirmed: ["pub-b"] }),
    );
    expect(points).toEqual([{ id: "pub-b", x: 220, y: 500 }]);
  });

  it("drops a pin the app chrome covers", () => {
    // The topbar would receive that tap, not the map.
    const points = paintedPinTapPoints(
      makeMap({ painted: [PIN_A, PIN_B], covered: ["pub-a"] }),
    );
    expect(points).toEqual([{ id: "pub-b", x: 220, y: 500 }]);
  });

  it("answers with nothing before the pin layers exist", () => {
    expect(paintedPinTapPoints(makeMap({ painted: [PIN_A], layers: [] })))
      .toEqual([]);
  });

  it("answers with nothing when the map paints no pin", () => {
    expect(paintedPinTapPoints(makeMap({ painted: [] }))).toEqual([]);
  });
});
