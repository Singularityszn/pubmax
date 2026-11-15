// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useMapReaderPosition } from "@/components/map/useMapReaderPosition";
import { useLogPickerLocation } from "@/components/map/pubmap/useLogPickerLocation";
import { createMapCameraOwnership } from "@/lib/mapCameraProvenance";
import { mapLocationWasExposed, markMapLocationExposure } from "@/lib/mapLocationExposure";

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
  owner.beginPublicPlace(camera.center, camera.zoom);
  owner.settle(camera);
  expect(owner.capture(camera)).toBeNull();
});

it("reports prompt permission without requesting geolocation on mount", async () => {
  vi.mocked(navigator.permissions.query).mockResolvedValue({
    state: "prompt",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as PermissionStatus);
  const onPermissionState = vi.fn();
  function Probe() {
    useMapReaderPosition(() => {}, onPermissionState);
    return null;
  }

  await act(async () => root.render(createElement(Probe)));

  expect(onPermissionState).toHaveBeenCalledWith("prompt");
  expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  expect(navigator.geolocation).not.toHaveProperty("getCurrentPosition");
});

it("consumes pre-React exposure even when the later permission query denies location", async () => {
  markMapLocationExposure();
  vi.mocked(navigator.permissions.query).mockResolvedValue({ state: "denied", addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as PermissionStatus);
  const owner = createMapCameraOwnership();
  const expose = () => owner.exposeLocation();
  function Probe() { useMapReaderPosition(expose); return null; }
  await act(async () => root.render(createElement(Probe)));
  expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
  owner.beginPublicPlace(camera.center, camera.zoom);
  owner.settle(camera);
  expect(owner.capture(camera)).toBeNull();
});

it.each(["absent", "rejected", "granted"] as const)("disables camera storage before automatic picker location with permission API %s", async (permission) => {
  const owner = createMapCameraOwnership();
  owner.beginPublicPlace(camera.center, camera.zoom);
  owner.settle(camera);
  const pendingSave = owner.capture(camera);
  expect(pendingSave).not.toBeNull();
  let locationSuccess: PositionCallback;
  let cameraAtRequest: ReturnType<typeof owner.capture> | undefined;
  vi.stubGlobal("navigator", {
    ...(permission === "absent" ? {} : {
      permissions: { query: permission === "rejected"
        ? vi.fn().mockRejectedValue(new Error("Permissions API unavailable"))
        : vi.fn().mockResolvedValue({ state: "granted", addEventListener: vi.fn(), removeEventListener: vi.fn() }) },
    }),
    geolocation: {
      getCurrentPosition: (callback: PositionCallback) => {
        cameraAtRequest = owner.capture(camera);
        locationSuccess = callback;
      },
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    },
  });
  const expose = () => owner.exposeLocation();
  function Picker() {
    useMapReaderPosition(expose);
    const { location } = useLogPickerLocation(true, null);
    return createElement("div", null, location ? `${location.lat},${location.lng}` : "waiting");
  }
  await act(async () => root.render(createElement(Picker)));
  expect(cameraAtRequest).toBeNull();
  expect(pendingSave!.isCurrent()).toBe(false);
  expect(mapLocationWasExposed()).toBe(true);
  expect(host.textContent).toBe("waiting");
  await act(async () => locationSuccess!({ coords: { latitude: 51.5255, longitude: -0.0878 } } as GeolocationPosition));
  expect(host.textContent).toBe("51.5255,-0.0878");
  owner.beginPublicPlace(camera.center, camera.zoom);
  owner.settle(camera);
  expect(owner.capture(camera)).toBeNull();
});
