// @vitest-environment jsdom

import { act, createElement, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useBuiltRouteHydration } from "@/components/map/pubmap/useBuiltRouteHydration";
import { useMapPlanPresentation } from "@/components/map/pubmap/useMapPlanCoordinator";
import { warmVenueDetail, type VenueDetailLookupResult } from "@/lib/warmVenueDetail";
import type { Venue } from "@/lib/venues";

vi.mock("@/lib/warmVenueDetail", () => ({ warmVenueDetail: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const pubs = [
  { id: "west", longitude: -0.14, latitude: 51.51 },
  { id: "east", longitude: -0.12, latitude: 51.52 },
] as Venue[];
const builtIds = ["west", "removed", "east"];
let root: Root;
let host: HTMLDivElement;
let resolveLookup: (result: VenueDetailLookupResult) => void;

function Probe({ requestedIds = builtIds, initialVenues = [] }: { requestedIds?: string[]; initialVenues?: Venue[] } = {}) {
  const [details, setDetails] = useState(() => new Map(initialVenues.map((venue) => [venue.id, venue])));
  const venueById = useMemo(() => new Map([...pubs.map((venue) => [venue.id, venue] as const), ...details]), [details]);
  const settledBuiltStopIds = useBuiltRouteHydration({ venueDataReady: true, builtIds: requestedIds, venueById, setDetailById: setDetails });
  const result = useMapPlanPresentation({
    mode: "build", builtIds: requestedIds, routeMapped: true, suggestedRoute: [], activePlanRoute: [], venueById, settledBuiltStopIds,
  });
  return createElement("output", null, JSON.stringify({ pending: result.routePending, ids: result.routeForMap.map((venue) => venue.id) }));
}

beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
  vi.mocked(warmVenueDetail).mockImplementation(() => new Promise((resolve) => { resolveLookup = resolve; }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

it.each(["missing", "failed"] as const)("settles a %s route stop without dropping the valid stops", async (status) => {
  act(() => root.render(createElement(Probe)));
  expect(JSON.parse(host.textContent ?? "{}")).toEqual({ pending: true, ids: ["west", "east"] });
  await act(async () => resolveLookup({ status }));
  expect(JSON.parse(host.textContent ?? "{}")).toEqual({ pending: false, ids: ["west", "east"] });
  act(() => root.render(createElement(Probe)));
  expect(JSON.parse(host.textContent ?? "{}")).toEqual({ pending: false, ids: ["west", "east"] });
});

it("merges a found stop before releasing the route", async () => {
  act(() => root.render(createElement(Probe)));
  const venue = { ...pubs[0]!, id: "removed" };
  await act(async () => resolveLookup({ status: "found", venue }));
  expect(JSON.parse(host.textContent ?? "{}")).toEqual({ pending: false, ids: ["west", "removed", "east"] });
});

it("keeps a historical walking-link stop after canonical detail hydration", async () => {
  act(() => root.render(createElement(Probe, { requestedIds: ["west", "venue-aihlwx", "east"] })));
  expect(JSON.parse(host.textContent ?? "{}")).toEqual({ pending: true, ids: ["west", "east"] });
  await act(async () => resolveLookup({ status: "found", venue: { ...pubs[0]!, id: "venue-7qifhm" } }));
  expect(JSON.parse(host.textContent ?? "{}")).toEqual({ pending: false, ids: ["west", "venue-7qifhm", "east"] });
  expect(warmVenueDetail).toHaveBeenCalledTimes(1);
});

it("uses an already loaded canonical stop for a historical walking link", () => {
  act(() => root.render(createElement(Probe, {
    requestedIds: ["west", "venue-aihlwx", "east"],
    initialVenues: [{ ...pubs[0]!, id: "venue-7qifhm" }],
  })));
  expect(JSON.parse(host.textContent ?? "{}")).toEqual({ pending: false, ids: ["west", "venue-7qifhm", "east"] });
  expect(warmVenueDetail).not.toHaveBeenCalled();
});
