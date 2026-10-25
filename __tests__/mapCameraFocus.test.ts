// @vitest-environment jsdom

// Picking an area must move the map, every time.
//
// DEFECT (captain, live, 2026-09-01, mobile): the map header read
// "Piccadilly & Soho" over a viewport of rural Cumbria. The chip is written
// from the remembered area, so it changed; the camera did not.
//
// The canvas takes ONE focus prop fed by TWO owners - the opening-location
// answer and the area lane - and each kept its own counter starting at 1 while
// the canvas remembered one bare number. A reader whose opening location had
// flown at token 1 then picked an area, that pick arrived as token 1, and the
// canvas read it as a move it had already made.

import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useMapCamera } from "@/components/map/canvas/useMapCamera";

import {
  cameraIntentForFocusSource,
  mapCameraFocusKey,
  mapCameraFocusMoves,
  nextAreaCameraFocus,
  openingCameraSettled,
  type MapCameraFocus,
} from "@/lib/mapCameraFocus";

const LONDON: [number, number] = [-0.1341, 51.5108];
const CUMBRIA: [number, number] = [-2.3216, 54.5232];

function focus(
  source: MapCameraFocus["source"],
  token: number,
  center: [number, number],
): MapCameraFocus {
  return { center, zoom: 14, source, token };
}

describe("two camera owners can never mint the same identity", () => {
  it("keys a focus by its owner as well as its count", () => {
    expect(mapCameraFocusKey(focus("opening-location", 1, CUMBRIA))).not.toBe(
      mapCameraFocusKey(focus("area", 1, LONDON)),
    );
  });

  it("moves the camera on the captain's journey: locate, then pick an area", () => {
    // 1. The opening location answers and the canvas flies to it.
    const located = focus("opening-location", 1, CUMBRIA);
    expect(mapCameraFocusMoves(located, null)).toBe(true);
    const afterLocate = mapCameraFocusKey(located);

    // 2. The reader picks Piccadilly & Soho. The area lane's own counter also
    //    starts at 1, and this is the move that used to be swallowed.
    const picked = focus("area", 1, LONDON);
    expect(mapCameraFocusMoves(picked, afterLocate)).toBe(true);
  });

  it("still refuses to re-fly the move it has already made", () => {
    const picked = focus("area", 1, LONDON);
    expect(mapCameraFocusMoves(picked, mapCameraFocusKey(picked))).toBe(false);
  });

  it("flies again when the same owner asks a second time", () => {
    const first = focus("area", 1, LONDON);
    const second = focus("area", 2, LONDON);
    expect(mapCameraFocusMoves(second, mapCameraFocusKey(first))).toBe(true);
  });

  it("flies again when the reader picks the same area after panning away", () => {
    const soho = { center: LONDON, zoom: 14 };
    const first = nextAreaCameraFocus(null, soho);
    expect(mapCameraFocusMoves(first, null)).toBe(true);
    // The canvas flies to Soho, then the reader pans away by gesture. A pan
    // mints no focus, so the canvas still holds the first pick's key.
    const appliedKey = mapCameraFocusKey(first);
    const second = nextAreaCameraFocus(first, soho);
    expect(mapCameraFocusKey(second)).not.toBe(appliedKey);
    expect(mapCameraFocusMoves(second, appliedKey)).toBe(true);
  });

  it("has nothing to do with no focus at all", () => {
    expect(mapCameraFocusMoves(null, null)).toBe(false);
    expect(mapCameraFocusMoves(undefined, "area:1")).toBe(false);
  });
});

// The second half of the same defect, surfaced by MapLibre 6.10.0 readying the
// map early enough that the opening-location answer can fly FIRST.
//
// The canvas counted both owners on ONE camera-intent kind, "area". A reader
// who searched an area then counted two area intents where the product
// promises one, and, because the kind is also the prefix of the camera
// coordinator's dedupe key, an opening-location fly to a view could swallow the
// reader's own pick of the same view inside the dedupe window.
describe("each camera owner rides its own intent lane", () => {
  it("gives the area lane the area intent", () => {
    expect(cameraIntentForFocusSource("area")).toBe("area");
  });

  it("does not let the opening answer count as an area pick", () => {
    expect(cameraIntentForFocusSource("opening-location")).toBe("opening-location");
  });

  it("gives no two owners the same lane", () => {
    const sources: MapCameraFocus["source"][] = ["opening-location", "area"];
    const lanes = sources.map(cameraIntentForFocusSource);
    expect(new Set(lanes).size).toBe(sources.length);
  });


});

// A cold map opens on the city view and makes its opening turn once the
// camera is still. The opening-location answer moves the camera too, and a
// move that lands during the turn stopped it at 1.3 degrees.
describe("the opening answer settles before the turn may start", () => {
  const unsettled = { resolving: true, cancelled: false, touched: false, focus: null };

  it("holds the turn while the answer is still to come", () => {
    expect(openingCameraSettled(unsettled)).toBe(false);
  });

  it("settles once the answer has minted its focus, wherever it points", () => {
    expect(openingCameraSettled({ ...unsettled, focus: focus("opening-location", 1, LONDON) })).toBe(true);
    expect(openingCameraSettled({ ...unsettled, focus: focus("opening-location", 1, CUMBRIA) })).toBe(true);
  });

  it("settles when there is no question, or the reader cancelled or took the map", () => {
    expect(openingCameraSettled({ ...unsettled, resolving: false })).toBe(true);
    expect(openingCameraSettled({ ...unsettled, cancelled: true })).toBe(true);
    expect(openingCameraSettled({ ...unsettled, touched: true })).toBe(true);
  });
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([false, true])("executes opening and area moves in separate lanes, reduced motion=%s", (reduced) => {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const map = { stop: vi.fn(), easeTo: vi.fn() };
  const refs: Parameters<typeof useMapCamera>[0] = {
    mapRef: { current: map as unknown as MapLibreMap },
    reducedRef: { current: reduced },
    cityViewRef: { current: { center: LONDON, zoom: 14, pitch: 34, bearing: 0 } },
    cityBoundsRef: { current: [[-0.5, 51.3], [0.2, 51.7]] },
    routeRef: { current: [] }, venuesRef: { current: [] },
    gestureCameraRef: { current: { active: false, endedAt: Number.NEGATIVE_INFINITY } },
  };
  let camera: ReturnType<typeof useMapCamera> | undefined;
  function Camera() { camera = useMapCamera(refs); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(createElement(Camera)));
    for (const source of ["opening-location", "area"] as const) {
      camera!.cinematic({ center: LONDON, zoom: 14, duration: 900 }, cameraIntentForFocusSource(source));
      const pending = [...frames.values()];
      frames.clear();
      act(() => pending.forEach((callback) => callback(0)));
    }
    expect(map.easeTo).toHaveBeenCalledTimes(2);
    expect(map.easeTo).toHaveBeenNthCalledWith(1, { center: LONDON, zoom: 14, duration: reduced ? 0 : 900 });
    expect(map.easeTo).toHaveBeenNthCalledWith(2, { center: LONDON, zoom: 14, duration: reduced ? 0 : 900 });
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
