// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { useCuratedWalkFocus } from "@/components/map/route/useCuratedWalkFocus";
import { curatedCrawls } from "@/lib/curatedCrawls";
import type { MapCameraFocus } from "@/lib/mapCameraFocus";
import type { MapSurfaceRetirement } from "@/lib/mapSurfaceState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const walk = curatedCrawls.find((crawl) => crawl.id === "london-christmas-walk")!.walk!;
let host: HTMLDivElement;
let root: Root;
let selectStop: (id: string) => void;
let events: string[];

function Probe() {
  const [venueId, setVenueId] = useState("inspected-pub");
  const [focus, setFocus] = useState<MapCameraFocus | null>(null);
  const [snap, setSnap] = useState("full");
  const retire = (surfaces: readonly MapSurfaceRetirement[]) => {
    events.push("retire");
    if (surfaces.includes("venue")) setVenueId("");
  };
  const focusStop = (next: MapCameraFocus) => { events.push("focus"); setFocus(next); };
  const selection = useCuratedWalkFocus(walk, setVenueId, focusStop, setSnap, retire);
  selectStop = selection.selectRouteStop;
  return createElement("output", null, JSON.stringify({ venueId, focus, snap, selected: selection.selectedWalkStopId }));
}

beforeEach(() => {
  events = [];
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(createElement(Probe)));
});
afterEach(() => act(() => root.unmount()));

it.each([0, 6, 12])("retires an inspected pub when focusing walk stop %s", (index) => {
  const stop = walk.stops[index]!;
  act(() => selectStop(stop.id));
  expect(events).toEqual(["retire", "focus"]);
  expect(JSON.parse(host.textContent!)).toMatchObject({
    venueId: "", selected: stop.id, snap: "half",
    focus: { center: [stop.longitude, stop.latitude], zoom: 16, source: "landmark" },
  });
});

it("still inspects a pub when a route selection is not a walk stop", () => {
  act(() => selectStop("another-pub"));
  expect(events).toEqual([]);
  expect(JSON.parse(host.textContent!)).toEqual({ venueId: "another-pub", focus: null, snap: "full", selected: "" });
});
