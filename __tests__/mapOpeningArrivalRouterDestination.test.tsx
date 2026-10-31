// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { useMapOpeningArrival } from "@/components/map/useMapOpeningArrival";
import { activeDrinkLane, drinkLaneLabel } from "@/lib/drinkLanes";
import { buildMapSeed, restoredSessionFrame, type RestoredSessionLike } from "@/lib/pubMap";
import { initialFilters } from "@/lib/venues";

const destination = vi.hoisted(() => ({ query: "sel=venue-eltcmh&drink=wine" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(destination.query),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  destination.query = "sel=venue-eltcmh&drink=wine";
  window.history.replaceState(null, "", "/");
});

// This session was eligible on an outgoing page with an empty query.
const savedPints = { filters: { ...initialFilters, drinkCategory: "", query: "Hatton", maxPrice: 6 } };

function ArrivalDrink({ savedSession }: { savedSession: RestoredSessionLike }) {
  const arrival = useMapOpeningArrival({
    cityId: "london", cityDisplayName: "London", placeArrival: null, nationalBrowse: false,
  });
  const seed = buildMapSeed(arrival.search, "london");
  // Deliberately pass the previously eligible session to the real composition.
  // This must catch a partial repair that fixes the seed but still lets saved Pints win.
  const frame = restoredSessionFrame({
    seed,
    restoredSession: savedSession,
    resumeSeed: null,
    cityId: "london",
    search: arrival.search,
    shouldOpenPlanningInitially: () => false,
  });
  return createElement("output", {
    "aria-label": "Selected drink",
    "data-selected-pub": frame.selectedVenueId,
    "data-max-price": frame.filters.maxPrice,
    "data-query": frame.filters.query,
  }, drinkLaneLabel(activeDrinkLane(frame.filters.drinkCategory)));
}

it("opens Wine from the router destination while the browser still names Moment", () => {
  window.history.replaceState(null, "", "/moment?returnTo=%2Fmap%3Fsel%3Dvenue-eltcmh%26drink%3Dwine");
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(ArrivalDrink, { savedSession: null })));
    expect(window.location.pathname).toBe("/moment");
    expect(window.location.search).toBe("?returnTo=%2Fmap%3Fsel%3Dvenue-eltcmh%26drink%3Dwine");
    const selected = host.querySelector('output[aria-label="Selected drink"]');
    expect(selected?.textContent).toBe("Wine");
    expect(selected?.getAttribute("data-selected-pub")).toBe("venue-eltcmh");
  } finally { act(() => root.unmount()); }
});

it("keeps explicit router Wine when the outgoing empty query made saved Pints eligible", () => {
  window.history.replaceState(null, "", "/moment");
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(ArrivalDrink, { savedSession: savedPints })));
    expect(window.location.pathname).toBe("/moment");
    expect(window.location.search).toBe("");
    const selected = host.querySelector('output[aria-label="Selected drink"]');
    expect(selected?.textContent).toBe("Wine");
    expect(selected?.getAttribute("data-selected-pub")).toBe("venue-eltcmh");
    expect(selected?.getAttribute("data-query")).toBe("");
  } finally { act(() => root.unmount()); }
});

it("restores saved Pints and its price limit for a genuinely empty router arrival", () => {
  destination.query = "";
  window.history.replaceState(null, "", "/moment?returnTo=%2Fmap%3Fsel%3Dvenue-eltcmh%26drink%3Dwine");
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(ArrivalDrink, { savedSession: savedPints })));
    expect(window.location.pathname).toBe("/moment");
    const selected = host.querySelector('output[aria-label="Selected drink"]');
    expect(selected?.textContent).toBe("Pints");
    expect(selected?.getAttribute("data-max-price")).toBe("6");
    expect(selected?.getAttribute("data-query")).toBe("");
    expect(selected?.getAttribute("data-selected-pub")).toBe("");
  } finally { act(() => root.unmount()); }
});

it("keeps the opening Wine snapshot when the mounted router query changes", () => {
  window.history.replaceState(null, "", "/map?sel=venue-eltcmh&drink=wine");
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(ArrivalDrink, { savedSession: savedPints })));
    const selected = () => host.querySelector('output[aria-label="Selected drink"]');
    expect(selected()?.textContent).toBe("Wine");
    expect(selected()?.getAttribute("data-selected-pub")).toBe("venue-eltcmh");
    // Rerender the existing root, without a key or unmount. The live router
    // query changes, but that does not become another opening arrival.
    destination.query = "drink=cocktail&log=1";
    window.history.replaceState(null, "", "/map?drink=cocktail&log=1");
    act(() => root.render(createElement(ArrivalDrink, { savedSession: savedPints })));
    expect(window.location.search).toBe("?drink=cocktail&log=1");
    expect(selected()?.textContent).toBe("Wine");
    expect(selected()?.getAttribute("data-selected-pub")).toBe("venue-eltcmh");
    expect(selected()?.getAttribute("data-query")).toBe("");
  } finally { act(() => root.unmount()); }
});
