// @vitest-environment jsdom

import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useNearMeRequests, type PendingNearMeRequest } from "@/components/map/pubmap/useNearMeRequests";
import { currentCameraRequestToken, nextCameraRequestToken } from "@/lib/cameraIntent";
import { readMapChosenArea, writeMapChosenArea } from "@/lib/mapChosenArea";

vi.mock("@/lib/mapReaderPosition", () => ({ latchMapReaderLocationWatch: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let actions: ReturnType<typeof useNearMeRequests>;
const callbacks: { success: PositionCallback; error: PositionErrorCallback | null | undefined }[] = [];
const position: GeolocationPosition = {
  coords: { latitude: 51.51, longitude: -0.13, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
  timestamp: 1, toJSON: () => ({}),
};
const error: GeolocationPositionError = { code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
const area = { cityId: "london", label: "Soho", slug: "soho", kind: "night-area", center: [-0.13, 51.51] } satisfies Parameters<typeof writeMapChosenArea>[0];

function Probe() {
  const [request, setRequest] = useState<PendingNearMeRequest | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [token, setToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  actions = useNearMeRequests({
    cityId: "london", stopCount: 3, invalidatePrivateCamera: () => {},
    setNearbyError: setError, setNearbyLoading: setLoading, setUserLocation: setLocation,
    setNearbyRequestToken: setToken, setPendingNearMeRequest: setRequest,
    openChooseAreaRef: useRef((note?: string | null) => setPicker(note ?? null)),
  });
  return createElement("output", null, JSON.stringify({ request, location, token, error, loading, picker }));
}

beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
  callbacks.length = 0;
  vi.stubGlobal("navigator", { geolocation: {
    getCurrentPosition: (success: PositionCallback, error?: PositionErrorCallback | null) => callbacks.push({ success, error }),
  } });
  writeMapChosenArea(area);
  act(() => root.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each(["tap", "arrival", "resume", "crawl"] as const)("ignores stale %s location success and error", (mode) => {
  act(() => mode === "crawl" ? actions.startNearbyCrawl() : actions.runNearMe(mode));
  nextCameraRequestToken();
  writeMapChosenArea(area);
  const before = host.textContent;
  act(() => callbacks[0]!.success(position));
  expect(host.textContent).toBe(before);
  expect(readMapChosenArea()).toEqual(area);
  act(() => callbacks[0]!.error?.(error));
  expect(host.textContent).toBe(before);
});

it.each(["tap", "arrival", "resume", "crawl"] as const)("publishes current %s location with its originating token", (mode) => {
  const previousToken = currentCameraRequestToken();
  act(() => mode === "crawl" ? actions.startNearbyCrawl() : actions.runNearMe(mode));
  const requestToken = currentCameraRequestToken();
  expect(requestToken).toBe(mode === "resume" ? previousToken : previousToken + 1);
  act(() => callbacks[0]!.success(position));
  expect(JSON.parse(host.textContent ?? "{}")).toMatchObject({
    request: { kind: mode === "crawl" ? "crawl" : "map", location: { lat: 51.51, lng: -0.13 }, requestToken },
    location: { lat: 51.51, lng: -0.13 }, token: mode === "crawl" || mode === "resume" ? 0 : requestToken,
  });
  expect(readMapChosenArea()).toEqual(mode === "crawl" ? area : {
    cityId: "london", label: "Near me", slug: "near-me", kind: "near-me",
  });
});

it.each(["tap", "arrival", "resume", "crawl"] as const)("handles a current %s location refusal", (mode) => {
  act(() => mode === "crawl" ? actions.startNearbyCrawl() : actions.runNearMe(mode));
  act(() => callbacks[0]!.error?.(error));
  const state = JSON.parse(host.textContent ?? "{}");
  expect(state.loading).toBe(false);
  expect(state.request).toBeNull();
  expect(state.location).toBeNull();
  if (mode === "arrival") expect(state.picker).toBeTruthy();
  else if (mode !== "resume") expect(state.error).toBeTruthy();
  else expect(state.error).toBeNull();
  expect(readMapChosenArea()).toEqual(area);
});
