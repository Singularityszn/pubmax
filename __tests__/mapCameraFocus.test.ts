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

import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMapOpeningCamera } from "@/components/map/useMapOpeningCamera";
import { useMapFocusPoint } from "@/components/map/canvas/useMapFocusPoint";

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

describe("mounted camera focus ownership", () => {
  let root: Root;
  let host: HTMLDivElement;
  let camera: ReturnType<typeof useMapOpeningCamera>;
  const cinematic = vi.fn();
  const cancelOpeningLocation = vi.fn();
  const cancelled = { current: false };
  const cityView = { center: LONDON, zoom: 12 };

  type Props = {
    resolved: boolean;
    viewport?: { center: [number, number]; zoom: number };
    area?: MapCameraFocus | null;
    ready?: boolean;
    shouldResolve?: boolean;
  };

  function Camera({ resolved, viewport = cityView, area = null, ready = true, shouldResolve = true }: Props) {
    camera = useMapOpeningCamera({
      shouldResolveOpeningLocation: shouldResolve,
      openingLocationResolved: resolved,
      openingLocationCancelledRef: cancelled,
      locationFirstMapView: viewport,
      cancelOpeningLocation,
    });
    const applied = useRef<string | null>(null);
    useMapFocusPoint(ready, area ?? camera.openingLocationFocus, applied, cinematic);
    return createElement("output", null, String(camera.mapCameraTouched));
  }

  function render(props: Props) {
    act(() => root.render(createElement(Camera, props)));
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    cinematic.mockReset();
    cancelOpeningLocation.mockReset();
    cancelled.current = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("waits for readiness and applies each owner's first move once", () => {
    render({ resolved: true, ready: false });
    expect(cinematic).not.toHaveBeenCalled();
    render({ resolved: true });
    expect(cinematic.mock.calls).toEqual([
      [{ center: LONDON, zoom: 12, duration: 900 }, "opening-location", "automatic"],
    ]);
    const area = nextAreaCameraFocus(null, { center: CUMBRIA, zoom: 14 });
    act(() => camera.claimMapCamera());
    render({ resolved: true, area });
    render({ resolved: true, area: { ...area } });
    expect(cinematic.mock.calls).toEqual([
      [{ center: LONDON, zoom: 12, duration: 900 }, "opening-location", "automatic"],
      [{ center: CUMBRIA, zoom: 14, duration: 900 }, "area", "user"],
    ]);
    render({ resolved: true, area: nextAreaCameraFocus(area, { center: CUMBRIA, zoom: 14 }) });
    expect(cinematic).toHaveBeenCalledTimes(3);
    expect(cinematic).toHaveBeenLastCalledWith(
      { center: CUMBRIA, zoom: 14, duration: 900 }, "area", "user",
    );
  });

  it.each([false, true])("keeps an explicit selection when location resolved is %s", (resolved) => {
    render({ resolved });
    cancelOpeningLocation.mockImplementation(() => {
      expect(camera.mapCameraTouchedRef.current).toBe(true);
    });
    act(() => camera.claimMapCamera());
    expect(cancelOpeningLocation).toHaveBeenCalledOnce();
    expect(host.textContent).toBe("true");
    expect(camera.openingLocationFocus).toBeNull();
    cinematic.mockClear();
    render({ resolved: true, viewport: { center: CUMBRIA, zoom: 16 } });
    expect(camera.openingLocationFocus).toBeNull();
    expect(cinematic).not.toHaveBeenCalled();
  });

  it("keeps a chosen area after a late location answer", () => {
    render({ resolved: false });
    act(() => camera.claimMapCamera());
    const area = nextAreaCameraFocus(null, { center: LONDON, zoom: 14 });
    render({ resolved: false, area });
    render({ resolved: true, viewport: { center: CUMBRIA, zoom: 16 }, area });
    expect(camera.openingLocationFocus).toBeNull();
    expect(cinematic.mock.calls).toEqual([
      [{ center: LONDON, zoom: 14, duration: 900 }, "area", "user"],
    ]);
  });

  it("accepts a location answer while the reader has not claimed the camera", () => {
    render({ resolved: false });
    expect(cinematic).not.toHaveBeenCalled();
    render({ resolved: true, viewport: { center: CUMBRIA, zoom: 16 } });
    expect(host.textContent).toBe("false");
    expect(cinematic.mock.calls).toEqual([
      [{ center: CUMBRIA, zoom: 16, duration: 900 }, "opening-location", "automatic"],
    ]);
    render({ resolved: true, viewport: { center: CUMBRIA, zoom: 16 } });
    expect(cinematic).toHaveBeenCalledOnce();
  });

  it("does not mint an opening focus for a cancelled or intentional arrival", () => {
    cancelled.current = true;
    render({ resolved: true });
    expect(camera.openingLocationFocus).toBeNull();
    cancelled.current = false;
    render({ resolved: true, shouldResolve: false });
    expect(camera.openingLocationFocus).toBeNull();
    expect(cinematic).not.toHaveBeenCalled();
  });
});
