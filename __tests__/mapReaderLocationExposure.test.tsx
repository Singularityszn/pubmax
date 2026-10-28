// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useMapReaderPosition } from "@/components/map/useMapReaderPosition";
import { createMapCameraOwnership } from "@/lib/mapCameraProvenance";
import { markMapLocationExposure } from "@/lib/mapLocationExposure";

let root: Root;
let host: HTMLDivElement;
let success: PositionCallback;
const camera = { center: [-0.134, 51.511] as [number, number], zoom: 14, pitch: 38, bearing: 0 };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as Window & { __pubmaxMapLocationExposed?: boolean }).__pubmaxMapLocationExposed;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("navigator", {
    permissions: { query: vi.fn(async () => ({ state: "granted", addEventListener: vi.fn(), removeEventListener: vi.fn() })) },
    geolocation: {
      watchPosition: vi.fn((callback: PositionCallback) => { success = callback; return 1; }),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete (window as Window & { __pubmaxMapLocationExposed?: boolean }).__pubmaxMapLocationExposed;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

it("taints the mounted map before the granted-permission watch delivers coordinates", async () => {
  const owner = createMapCameraOwnership();
  const order: string[] = [];
  const expose = () => { order.push("exposure"); owner.exposeLocation(); };
  function Probe() {
    const position = useMapReaderPosition(expose);
    useEffect(() => { if (position) order.push("position"); }, [position]);
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  expect(order).toContain("exposure");
  await act(async () => success({ coords: { latitude: 51.5286, longitude: -0.0916478, accuracy: 10 } } as GeolocationPosition));
  expect(order.indexOf("exposure")).toBeLessThan(order.indexOf("position"));
  owner.beginPublicPlace(camera.center);
  owner.settle(camera);
  expect(owner.capture(camera)).toBeNull();
});

it("consumes pre-React exposure even when the later permission query denies location", async () => {
  markMapLocationExposure();
  vi.mocked(navigator.permissions.query).mockResolvedValue({ state: "denied", addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as PermissionStatus);
  const owner = createMapCameraOwnership();
  const expose = () => owner.exposeLocation();
  function Probe() { useMapReaderPosition(expose); return null; }
  await act(async () => root.render(createElement(Probe)));
  expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  owner.beginPublicPlace(camera.center);
  owner.settle(camera);
  expect(owner.capture(camera)).toBeNull();
});
