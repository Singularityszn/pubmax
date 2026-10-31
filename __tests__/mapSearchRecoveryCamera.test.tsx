// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, expect, it, vi } from "vitest";

import { useMapCamera } from "@/components/map/canvas/useMapCamera";
import type { Venue } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows known matches immediately after a pan while reactive query fits remain held", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.spyOn(performance, "now").mockReturnValue(1_001);
  const map = { fitBounds: vi.fn(), stop: vi.fn(), getBearing: () => -12 };
  const gestureCameraRef = { current: { active: false, endedAt: 1_000 } };
  const refs: Parameters<typeof useMapCamera>[0] = {
    mapRef: { current: map as unknown as MapLibreMap },
    reducedRef: { current: false },
    cityViewRef: { current: { center: [-0.13, 51.51], zoom: 13, pitch: 42, bearing: -12 } },
    cityBoundsRef: { current: [[-0.5, 51.3], [0.2, 51.7]] },
    routeRef: { current: [] },
    routeLineRef: { current: { type: "FeatureCollection", features: [] } },
    venuesRef: { current: [
      { id: "first", longitude: -0.19, latitude: 51.50 },
      { id: "second", longitude: -0.20, latitude: 51.51 },
    ] as Venue[] },
    gestureCameraRef,
  };
  let camera: ReturnType<typeof useMapCamera>;
  function MapCamera() {
    camera = useMapCamera(refs);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const flushFrame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => callbacks.forEach((callback) => callback(1_001)));
  };
  try {
    act(() => root.render(createElement(MapCamera)));
    camera!.fitQueryVenues();
    flushFrame();
    expect(map.fitBounds).not.toHaveBeenCalled();

    camera!.fitQueryVenues("search-recovery", 1);
    flushFrame();
    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect(map.fitBounds.mock.calls[0]?.[0].toArray()).toEqual([[-0.20, 51.50], [-0.19, 51.51]]);

    gestureCameraRef.current.active = true;
    camera!.fitQueryVenues("search-recovery", 2);
    flushFrame();
    expect(map.fitBounds).toHaveBeenCalledOnce();

    gestureCameraRef.current.active = false;
    camera!.fitQueryVenues("search-recovery", 3);
    flushFrame();
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
  }
});
