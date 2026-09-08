// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import { getCity, pointInCityBounds } from "@/lib/cities";
import type { MapCameraFocus } from "@/lib/mapCameraFocus";
import { resolveMapOpeningView, type MapOpeningLocation } from "@/lib/mapOpeningLocation";
import { mapArrivalFrame, shouldResolveOpeningLocation } from "@/lib/pubMap";
import { openingLocationCancellationAfterAttempt } from "@/lib/slimShards";
import { initialFilters } from "@/lib/venues";

const source = readFileSync("components/PubMap.tsx", "utf8");
function callerBlock(start: string, end: string): string {
  const from = source.indexOf(start);
  const until = source.indexOf(end, from);
  if (from < 0 || until < 0) throw new Error(`Missing opening caller block: ${start}`);
  return source.slice(from, until);
}

const city = getCity("london");
const readLocation = vi.fn<() => Promise<MapOpeningLocation | null>>();
const writeLocation = vi.fn();
const noop = () => {};
const scope = {
  useState, useMemo, useRef, useEffect, useCallback,
  mapArrivalFrame, shouldResolveOpeningLocationFor: shouldResolveOpeningLocation,
  resolveMapOpeningView, pointInCityBounds, openingLocationCancellationAfterAttempt,
  readOpeningMapLocation: readLocation, writeMapOpeningLocation: writeLocation,
  city, cityId: "london", ukPlaceArrival: null, ukNationalBrowse: false,
  lastKnownLocation: null, initialMapView: city.mapView, LOCATION_FIRST_ZOOM: 15,
  OPENING_LOCATION_HOLD_VIEW: { center: [0, 0], zoom: 0, pitch: 0, bearing: 0 },
  currentSearch: () => window.location.search,
  clearAreaSheetTimer: noop, setSearchAreaTarget: noop, clearLogIntent: noop,
  closeComposer: noop, setMapOverlay: noop, setPlanningOpen: noop,
  setMapListOpen: noop, setActiveLandmarkId: noop, setNearbyMapResult: noop,
};

// Real React hooks execute the caller's eligibility, resolution, focus and Close
// statements. Unrelated map UI and the external location answer stay outside.
const emitted = ts.transpileModule(`
  return function useOpeningCaller(resumed) {
    const [selectedVenueId, setSelectedVenueId] = useState(() => new URLSearchParams(currentSearch()).get("sel") ?? "");
    const mapResumeSeed = resumed ? { rows: [] } : null;
    const restoredMobileSession = null;
    const mapCameraTouchedRef = useRef(false);
    ${callerBlock("const arrivalSearchNow =", "const [initialMapView]")}
    ${callerBlock("const [openingLocationFocus,", "const ambientBannerLane =")}
    ${callerBlock("const shouldResolveOpeningLocation =", "const dismissAmbientBanners =")}
    ${callerBlock("useEffect(() => {\n    if (!shouldResolveOpeningLocation) return;", "// Everything this arrival already knows")}
    ${callerBlock("const fallbackOpeningMapView =", "const openingLoadViewport =")}
    ${callerBlock("useEffect(() => {\n    if (\n      !shouldResolveOpeningLocation ||", "const scheduleRingLoad =")}
    ${callerBlock("const [areaFocus,", "const flyToArea =")}
    ${callerBlock("const closeEverySurface =", "useEffect(() => {\n    const onDismiss")}
    return { selectedVenueId, closeEverySurface, moveMapCameraTo,
      arrival, shouldResolveOpeningLocation, openingLocationResolved,
      openingLocationFocus, areaFocus };
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

type Reading = {
  selectedVenueId: string;
  closeEverySurface: () => void;
  moveMapCameraTo: (camera: { center: [number, number]; zoom: number }) => void;
  arrival: ReturnType<typeof mapArrivalFrame>;
  shouldResolveOpeningLocation: boolean;
  openingLocationResolved: boolean;
  openingLocationFocus: MapCameraFocus | null;
  areaFocus: MapCameraFocus | null;
};
const useOpeningCaller = new Function(...Object.keys(scope), emitted)(...Object.values(scope)) as
  (resumed: boolean) => Reading;

let reading: Reading;
function Harness({ resumed = false }: { resumed?: boolean }) {
  const value = useOpeningCaller(resumed);
  const urlState = useMemo(() => ({
    mode: "suggest" as const, filters: initialFilters, builtIds: [], selectedVenueId: value.selectedVenueId,
  }), [value.selectedVenueId]);
  useCrawlUrlSync(urlState);
  useEffect(() => { reading = value; });
  return createElement("button", { onClick: value.closeEverySurface }, "Close pub detail");
}

let root: Root;
let host: HTMLDivElement;
let answerLocation: (location: MapOpeningLocation | null) => void;

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  readLocation.mockReset();
  writeLocation.mockReset();
  readLocation.mockImplementation(() => new Promise((resolve) => { answerLocation = resolve; }));
  window.history.replaceState({}, "", "/map");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function render(resumed = false) {
  await act(async () => { root.render(createElement(Harness, { resumed })); });
}

async function closeDeepLink() {
  act(() => host.querySelector("button")!.click());
  act(() => vi.advanceTimersByTime(300));
  expect(window.location.search).toBe("");
  // PubMap reads live search on later renders after the URL sync writes it.
  await render();
}

describe("opening location belongs to the actual map arrival", () => {
  it("does not start an opening read or reset after closing a deep-linked venue", async () => {
    window.history.replaceState({}, "", "/map?sel=venue-1kt3p9o");
    await render();
    expect(reading.shouldResolveOpeningLocation).toBe(false);
    expect(reading.openingLocationResolved).toBe(true);
    await closeDeepLink();

    expect(reading.selectedVenueId).toBe("");
    expect(reading.arrival.needsOpeningResolution).toBe(true);
    expect(readLocation).not.toHaveBeenCalled();
    expect(reading.shouldResolveOpeningLocation).toBe(false);
    expect(reading.openingLocationFocus).toBeNull();
  });

  it.each([null, { lat: 51.51, lng: -0.09 }])(
    "lets a true clean arrival resolve its location answer %j", async (location) => {
      await render();
      expect(readLocation).toHaveBeenCalledOnce();
      expect(reading.openingLocationResolved).toBe(false);
      expect(reading.openingLocationFocus).toBeNull();
      await act(async () => { answerLocation(location); });
      const focus = {
        center: location ? [location.lng, location.lat] : city.mapView.center,
        zoom: location ? 15 : city.mapView.zoom, source: "opening-location", token: 1,
      };
      expect(reading.openingLocationFocus).toEqual(focus);
      expect(reading.openingLocationResolved).toBe(true);
      expect(writeLocation).toHaveBeenCalledTimes(location ? 1 : 0);
      await render();
      expect(reading.openingLocationFocus).toEqual(focus);
      expect(readLocation).toHaveBeenCalledOnce();
    },
  );

  it("preserves an explicit area pick while the clean arrival's location read is pending", async () => {
    await render();
    const picked = { center: [-0.14, 51.52] as [number, number], zoom: 14 };
    act(() => reading.moveMapCameraTo(picked));
    await act(async () => { answerLocation({ lat: 51.51, lng: -0.09 }); });
    expect(reading.openingLocationFocus).toBeNull();
    expect(reading.areaFocus).toEqual({ ...picked, source: "area", token: 1 });
    expect(writeLocation).not.toHaveBeenCalled();
  });

  it("preserves an explicit area pick after closing a deep-linked venue", async () => {
    window.history.replaceState({}, "", "/map?sel=venue-1kt3p9o");
    await render();
    await closeDeepLink();
    const picked = { center: [-0.14, 51.52] as [number, number], zoom: 14 };
    act(() => reading.moveMapCameraTo(picked));
    await render();
    expect(reading.openingLocationFocus).toBeNull();
    expect(reading.areaFocus).toEqual({ ...picked, source: "area", token: 1 });
    expect(readLocation).not.toHaveBeenCalled();
  });

  it("allows opening location on a new clean mount after the deep link closes", async () => {
    window.history.replaceState({}, "", "/map?sel=venue-1kt3p9o");
    await render();
    await closeDeepLink();
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    expect(reading.shouldResolveOpeningLocation).toBe(true);
    expect(reading.openingLocationResolved).toBe(false);
    expect(readLocation).toHaveBeenCalledOnce();
  });

  it("keeps an existing resume from asking for opening location", async () => {
    await render(true);
    expect(readLocation).not.toHaveBeenCalled();
    expect(reading.openingLocationFocus).toBeNull();
  });
});
