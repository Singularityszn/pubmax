// @vitest-environment jsdom

import { act, createElement, Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { useMapOpeningArrival, useNamedMapAreaArrival } from "@/components/map/useMapOpeningArrival";
import { getCity } from "@/lib/cities";
import { mapAreaOpeningView, parseMapAreaArrival } from "@/lib/mapAreaArrival";
import { openingViewportFrom } from "@/lib/pubMap";
import ChooseAreaSheet from "@/components/map/ChooseAreaSheet";
import FirstRunTour from "@/components/onboarding/FirstRunTour";
import { setMapFirstVisitArrivalCardVisible } from "@/lib/mapFirstVisitArrivalGate";
import { promptBudgetHolder } from "@/lib/promptBudget";

vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  usePathname: () => "/map",
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => window.history.replaceState(null, "", "/"));

it("keeps the opening lifecycle when search writes a query and selects a pub", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  let opening: ReturnType<typeof useMapOpeningArrival> | undefined;
  function MapOpening() {
    const arrival = useMapOpeningArrival({
      cityId: "london", cityDisplayName: "London", placeArrival: null, nationalBrowse: false,
    });
    opening = arrival;
    return createElement("span", null, arrival.frame.needsOpeningResolution ? "Opening near you" : "Opening a link");
  }
  window.history.replaceState(null, "", "/map");
  try {
    act(() => root.render(createElement(MapOpening)));
    const originalFrame = opening!.frame;
    for (const query of ["?q=Churchill+Arms", "?q=Churchill+Arms&sel=venue-17h8293", "?q=Soho"]) {
      window.history.replaceState(null, "", `/map${query}`);
      act(() => root.render(createElement(MapOpening)));
      expect(opening!.search).toBe("");
      expect(opening!.frame).toBe(originalFrame);
      expect(host.textContent).toBe("Opening near you");
    }
  } finally {
    act(() => root.unmount());
  }
});

it("opens the named city area before a saved viewport and keeps its name after URL sync", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  function NamedAreaMap() {
    const opening = useMapOpeningArrival({
      cityId: "london", cityDisplayName: "London", placeArrival: null, nationalBrowse: false,
    });
    const explicit = mapAreaOpeningView(opening.area, getCity("london").mapView);
    const view = openingViewportFrom(
      { center: [-0.3, 51.45], zoom: 11, pitch: 0, bearing: 0 },
      null,
      explicit,
    );
    return createElement("output", null, JSON.stringify({ name: opening.area?.name, view }));
  }
  window.history.replaceState(null, "", "/map?area=piccadilly-soho");
  try {
    act(() => root.render(createElement(NamedAreaMap)));
    expect(JSON.parse(host.textContent!)).toMatchObject({
      name: "Piccadilly & Soho", view: { center: [-0.134, 51.511], zoom: 14 },
    });
    window.history.replaceState(null, "", "/map?q=Churchill+Arms");
    act(() => root.render(createElement(NamedAreaMap)));
    expect(JSON.parse(host.textContent!).name).toBe("Piccadilly & Soho");
  } finally {
    act(() => root.unmount());
  }
});

it("rejects unknown areas and areas from another city", () => {
  expect(parseMapAreaArrival("?area=piccadilly-soho", "manchester")).toBeNull();
  expect(parseMapAreaArrival("?area=unknown", "london")).toBeNull();
  expect(parseMapAreaArrival("?area=https%3A%2F%2Fexample.com", "london")).toBeNull();
  expect(parseMapAreaArrival("?area=piccadilly-soho&q=Churchill+Arms", "london")).toBeNull();
  expect(parseMapAreaArrival("?area=piccadilly-soho&sel=venue-17h8293", "london")).toBeNull();
});

it("consumes a pending named area when the reader takes the camera before venue loading ends", async () => {
  const root = createRoot(document.createElement("div"));
  const onSelect = vi.fn();
  const readerActed = { current: false };
  const area = parseMapAreaArrival("?area=piccadilly-soho", "london");
  function Opening({ ready }: { ready: boolean }) {
    useNamedMapAreaArrival({ area, ready, readerActed, onSelect });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Opening, { ready: false })));
    readerActed.current = true;
    await act(async () => root.render(createElement(Opening, { ready: false })));
    await act(async () => root.render(createElement(Opening, { ready: true })));
    expect(onSelect).not.toHaveBeenCalled();
    readerActed.current = false;
    await act(async () => root.render(createElement(Opening, { ready: false })));
    await act(async () => root.render(createElement(Opening, { ready: true })));
    expect(onSelect).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});

it.each([false, true])("keeps a deferred tour behind area selection (opening=%s)", async (opening) => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  window.history.replaceState(null, "", "/map");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const picker = createElement(ChooseAreaSheet, {
    cityId: "london", venues: [], showOpeningProgress: opening, onPick: () => {},
  });
  const render = (area: boolean, tour: boolean) => root.render(createElement(StrictMode, null,
    createElement(Fragment, null, area ? picker : null, tour ? createElement(FirstRunTour) : null),
  ));
  try {
    setMapFirstVisitArrivalCardVisible(true);
    await act(async () => render(true, false));
    await act(async () => setMapFirstVisitArrivalCardVisible(false));
    await act(async () => render(true, true));
    expect(host.querySelector(".chooseAreaSheet")).not.toBeNull();
    expect(host.querySelector(".tourScrim")).toBeNull();
    expect(promptBudgetHolder()).toBeNull();
    expect(window.localStorage.getItem("pubmax-tour-v2-done")).toBeNull();

    await act(async () => render(false, true));
    expect(host.querySelector(".tourScrim")).not.toBeNull();
    expect(promptBudgetHolder()).toBe("first-run-tour");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    setMapFirstVisitArrivalCardVisible(false);
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});

it("applies an untouched named arrival once when its venues become ready", async () => {
  const root = createRoot(document.createElement("div"));
  const onSelect = vi.fn();
  const readerActed = { current: false };
  const area = parseMapAreaArrival("?area=piccadilly-soho", "london");
  function Opening({ ready }: { ready: boolean }) {
    useNamedMapAreaArrival({ area, ready, readerActed, onSelect });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Opening, { ready: false })));
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Opening, { ready: true })));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(area);
    await act(async () => root.render(createElement(Opening, { ready: true })));
    expect(onSelect).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
  }
});
