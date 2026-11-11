// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useMapSplitListPointerHold,
  type MapSplitListPointerView,
} from "@/components/map/useMapSplitListPointerHold";
import { MAP_SPLIT_LIST_DEBOUNCE_MS } from "@/lib/mapSplitList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function view(name: string, empty = false): MapSplitListPointerView {
  return {
    groups: {
      venues: empty ? [] : [{
        id: name,
        name,
        lng: -0.13,
        lat: 51.513,
        group: "venue",
        distanceKm: null,
        walkMinutes: null,
        price: null,
        unpricedLabel: null,
        venue: null,
        basePub: null,
      }],
      basePubs: [],
      restaurants: [],
      total: empty ? 0 : 1,
    },
    key: name,
    order: name,
    coverageNote: name,
    heldIsStale: name === "new",
  };
}

function Probe(props: Parameters<typeof useMapSplitListPointerHold>[0]) {
  const { displayed, release } = useMapSplitListPointerHold(props);
  return createElement("button", { onClick: release }, JSON.stringify(displayed));
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

function render(current: MapSplitListPointerView, pointerInside = true, loaded = true) {
  act(() => root.render(createElement(Probe, { current, pointerInside, loaded })));
}

function expectView(expected: MapSplitListPointerView) {
  expect(JSON.parse(host.textContent!)).toEqual(expected);
}

describe("useMapSplitListPointerHold", () => {
  it("holds the rows and header together until 250 ms after the pointer leaves", () => {
    const original = view("original");
    const latest = view("new");
    render(original);
    render(latest);
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expectView(original);

    render(latest, false);
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS - 1));
    expectView(original);
    act(() => vi.advanceTimersByTime(1));
    expectView(latest);
  });

  it.each([false, true])("accepts the first rows under the pointer with loaded=%s", (loaded) => {
    render(view("empty", true), true, loaded);
    const arrived = view("arrived");
    render(arrived);
    expectView(arrived);
    render(view("new"));
    expectView(arrived);
  });

  it("clears a held view while loading and accepts subsequent loading updates", () => {
    render(view("original"));
    const loading = view("loading");
    render(loading, true, false);
    expectView(loading);
    const latest = view("new");
    render(latest, true, false);
    expectView(latest);
    render(latest);
    render(view("later"));
    expectView(latest);
  });

  it("applies an explicit action immediately and holds its result under the pointer", () => {
    render(view("original"));
    const latest = view("new");
    render(latest);
    act(() => host.querySelector("button")!.click());
    expectView(latest);
    render(view("later"));
    expectView(latest);
  });

  it("cancels a pending release when the pointer returns", () => {
    const original = view("original");
    const latest = view("new");
    render(original);
    render(latest, false);
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS - 1));
    render(latest);
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expectView(original);
    render(latest, false);
    act(() => vi.advanceTimersByTime(MAP_SPLIT_LIST_DEBOUNCE_MS));
    expectView(latest);
  });

  it("displays updates immediately when the pointer stays outside", () => {
    render(view("original"), false);
    const latest = view("new");
    render(latest, false);
    expectView(latest);
  });
});
