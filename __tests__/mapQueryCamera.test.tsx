// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Map, LngLatBounds } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMapCamera } from "@/components/map/canvas/useMapCamera";
import type { Venue } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const pub = (id: string, longitude: number, latitude: number) =>
  ({ id, longitude, latitude }) as Venue;
const soho = [pub("soho-west", -0.139, 51.514), pub("soho-east", -0.129, 51.516)];
const surrounding = [...soho, pub("outside-query", -2.244, 53.483)];

let host: HTMLDivElement;
let root: Root;
let pendingFrame: FrameRequestCallback | undefined;
let camera: ReturnType<typeof useMapCamera>;
const fitBounds = vi.fn();

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pendingFrame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  pendingFrame = undefined;
  fitBounds.mockReset();
  vi.unstubAllGlobals();
});

function mount(queryVenuesRef: { current: Venue[] }) {
  function Camera() {
    camera = useMapCamera({
      mapRef: { current: { stop: vi.fn(), fitBounds, getBearing: () => -8 } as unknown as Map },
      reducedRef: { current: true },
      cityViewRef: { current: { center: [-0.13, 51.51], zoom: 12, pitch: 40, bearing: -8 } },
      cityBoundsRef: { current: [[-0.3, 51.4], [0.1, 51.7]] },
      routeRef: { current: [] },
      venuesRef: { current: surrounding },
      queryVenuesRef,
      gestureCameraRef: { current: { active: false, endedAt: null } },
    });
    return null;
  }
  act(() => root.render(createElement(Camera)));
}

function fitQuery() {
  act(() => {
    camera.fitQueryVenues();
    pendingFrame?.(performance.now());
    pendingFrame = undefined;
  });
}

describe("query camera with contextual price pins", () => {
  it("frames only the query matches while other pins remain in the map dataset", () => {
    mount({ current: soho });
    fitQuery();
    const bounds = fitBounds.mock.calls[0]?.[0] as LngLatBounds;
    expect(bounds.toArray()).toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
  });

  it("reads the latest query matches when a later search moves the camera", () => {
    const queryVenuesRef = { current: soho };
    mount(queryVenuesRef);
    queryVenuesRef.current = [pub("hatton", -0.109, 51.518)];
    fitQuery();
    const bounds = fitBounds.mock.calls[0]?.[0] as LngLatBounds;
    expect(bounds.toArray()).toEqual([[-0.109, 51.518], [-0.109, 51.518]]);
  });

  it("keeps the camera still when the query has no matches", () => {
    mount({ current: [] });
    fitQuery();
    expect(fitBounds).not.toHaveBeenCalled();
  });
});
