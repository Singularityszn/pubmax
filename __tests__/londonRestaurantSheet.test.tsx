// @vitest-environment jsdom

// The London restaurant layer from the shell's side: the pack is read once,
// when it is first wanted, the drawn list is new only when the restaurants on
// it change, and the sheet a tapped restaurant opens says what the map knows
// and where that came from, and claims no price.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import LondonRestaurantSheet from "@/components/map/LondonRestaurantSheet";
import { useLondonRestaurants, useStableRestaurantList } from "@/components/map/useLondonRestaurants";
import { useFilteredLondonRestaurants } from "@/components/map/useFilteredLondonRestaurants";
import { usePublicPriceVenues } from "@/components/map/pubmap/usePublicPriceVenues";
import { useReleaseLondonVenueSelection } from "@/components/map/useCoffeePilotCafes";
import { londonVenueSelection } from "@/lib/pubMap";
import { LONDON_RESTAURANT_PACK_PATH } from "@/lib/londonRestaurants";
import { initialFilters, type Venue } from "@/lib/venues";
import { slimVenueToPin } from "@/lib/slimPins";

const ROOT = resolve(__dirname, "..");

const container = document.createElement("div");
const root = createRoot(container);

const layerInput = {
  isLondon: true,
  restaurantKindVisible: false,
  experienceLens: "all",
  lensOwnsMap: false,
  held: false,
  zoom: 13,
  selectedIsCafe: false,
} satisfies Omit<Parameters<typeof useLondonRestaurants>[0], "selectedVenueId">;

function RestaurantLayer({ wanted, selected, fullLayer, zoom = layerInput.zoom }: { wanted: boolean; selected?: string; fullLayer?: boolean; zoom?: number }) {
  const read = useLondonRestaurants({ ...layerInput, zoom, held: !wanted, selectedVenueId: selected ?? "", restaurantKindVisible: fullLayer ?? !selected });
  const furnival = read.byId.get("venue-osm-n25496840");
  return createElement(
    "div",
    { "data-status": read.status, "data-count": read.restaurants.length },
    furnival ? createElement(LondonRestaurantSheet, { restaurant: furnival }) : null,
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root.render(null));
  container.remove();
  vi.unstubAllGlobals();
});

function stubPack(answer: () => "ok" | "down") {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (answer() === "down") return new Response("down", { status: 503 });
    const body = readFileSync(join(ROOT, "public", String(input).replace(/^\//, "")), "utf8");
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("reads nothing until the layer is wanted, then reads the pack once", async () => {
  const fetchMock = stubPack(() => "ok");

  await act(async () => root.render(createElement(RestaurantLayer, { wanted: false })));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("idle");

  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: false })));
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));

  expect(fetchMock.mock.calls.filter(([url]) => url === LONDON_RESTAURANT_PACK_PATH)).toHaveLength(1);
  const layer = container.querySelector("[data-status]");
  expect(layer?.getAttribute("data-status")).toBe("ready");
  expect(Number(layer?.getAttribute("data-count"))).toBeGreaterThan(1000);
});

it("asks again after a failed read the next time the layer is wanted", async () => {
  let state: "ok" | "down" = "down";
  const fetchMock = stubPack(() => state);

  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));
  expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("failed");

  state = "ok";
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: false })));
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));

  expect(fetchMock.mock.calls.filter(([url]) => url === LONDON_RESTAURANT_PACK_PATH)).toHaveLength(2);
  expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("ready");
});

it.each(["ok", "down"] as const)("preserves pending full-layer chunks across selection and close when they finish %s", async (outcome) => {
  let release: () => void = () => { throw new Error("No chunk is pending."); };
  const pending = new Promise<void>(resolve => { release = resolve; });
  let response = outcome;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const body = readFileSync(join(ROOT, "public", String(input).replace(/^\//, "")), "utf8");
    if (String(input).includes("/packs/")) {
      await pending;
      if (response === "down") return new Response("down", { status: 503 });
    }
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);

  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true, fullLayer: true })));
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/packs/"))).toHaveLength(6);
  for (const selected of ["the-george", "", "venue-osm-n25496840", "another-pub"]) {
    await act(async () => root.render(createElement(RestaurantLayer, { wanted: true, fullLayer: true, selected })));
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("loading");
    expect(fetchMock.mock.calls.filter(([url]) => url === LONDON_RESTAURANT_PACK_PATH)).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/packs/"))).toHaveLength(6);
  }

  await act(async () => release());
  expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe(outcome === "ok" ? "ready" : "failed");
  if (outcome === "down") {
    response = "ok";
    await act(async () => root.render(createElement(RestaurantLayer, { wanted: true, fullLayer: true, selected: "venue-osm-n25496840" })));
    expect(fetchMock.mock.calls.filter(([url]) => url === LONDON_RESTAURANT_PACK_PATH)).toHaveLength(2);
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("ready");
  }
  expect(Number(container.querySelector("[data-count]")?.getAttribute("data-count"))).toBeGreaterThan(1000);
});

it("keeps the pending full-layer read while zooming below its drawing floor", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const body = readFileSync(join(ROOT, "public", String(input).replace(/^\//, "")), "utf8");
    if (String(input).includes("/packs/")) await pending;
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);

  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true, zoom: 13 })));
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true, zoom: 11 })));
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true, zoom: 13 })));
  expect(fetchMock.mock.calls.filter(([url]) => url === LONDON_RESTAURANT_PACK_PATH)).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/packs/"))).toHaveLength(6);
  await act(async () => release());
  expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("ready");
  expect(Number(container.querySelector("[data-count]")?.getAttribute("data-count"))).toBeGreaterThan(1000);
});

it("credits OSM without adding prices or an alcohol claim", async () => {
  stubPack(() => "ok");

  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));

  const sheet = container.querySelector("[data-london-restaurant='venue-osm-n25496840']");
  expect(sheet?.querySelector("h2")?.textContent).toBe("26 Furnival Street");
  expect(sheet?.textContent).toContain("Restaurant");
  expect(sheet?.textContent).toContain("26, Furnival Street, London, EC4A 1JS");
  expect(sheet?.textContent).not.toContain("serves alcohol");
  expect(sheet?.querySelector("a[href=\"https://www.openstreetmap.org/node/25496840\"]")).not.toBeNull();
  expect(sheet?.textContent).not.toContain("logged");
  expect(sheet?.textContent).not.toMatch(/£\d/);
  const credit = sheet?.querySelector("a[href='https://www.openstreetmap.org/copyright']");
  expect(credit?.textContent).toBe("OpenStreetMap contributors");
});

it.each(["Mo-Su 12:00-23:30", "PH unknown"])("credits the extract date for restaurant facts and shared hours: %s", async openingHours => {
  // Geofabrik's extract timestamp describes the data, not a visit or the day the app reads it.
  await act(async () => root.render(createElement(LondonRestaurantSheet, { restaurant: {
    id: "venue-osm-n101", name: "Example", address: "", lat: 51.5, lng: -0.1, kind: "restaurant", borough: "",
    observedAt: "2026-11-15T23:00:00Z", openingHours,
  } })));
  expect(container.querySelector(".londonRestaurantSource")?.textContent).toContain("OSM data as of 15 Nov 2026");
  expect(container.querySelector(".venuePlacesDetailsCredit")?.textContent).toBe("OSM data as of 15 Nov 2026");
  const details = container.querySelector("details")!;
  await act(async () => details.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  if (openingHours.startsWith("Mo-Su")) expect(details.querySelector("dd")?.textContent).toBe("12:00 to 23:30");
  else expect(details.querySelector("p")?.textContent).toBe(openingHours);
});

it("hands the canvas a new list only when the restaurants on it change", async () => {
  const drawn: (readonly { id: string }[])[] = [];
  function DrawnRestaurants({ list }: { list: readonly { id: string }[] }) {
    drawn.push(useStableRestaurantList(list));
    return null;
  }
  const rules = { id: "venue-osm-n101" };
  const furnival = { id: "venue-osm-n25496840" };

  await act(async () => root.render(createElement(DrawnRestaurants, { list: [rules, furnival] })));
  await act(async () => root.render(createElement(DrawnRestaurants, { list: [rules, furnival] })));
  await act(async () => root.render(createElement(DrawnRestaurants, { list: [furnival] })));

  expect(drawn).toHaveLength(3);
  expect(drawn[1]).toBe(drawn[0]);
  expect(drawn[2]).not.toBe(drawn[0]);
  expect(drawn[2]).toEqual([furnival]);
});

it("does not rescan restaurants through two price-only refreshes", async () => {
  const baseVenues = [slimVenueToPin({
    id: "venue-rules", name: "Rules", lat: 51.51083, lng: -0.12319,
    cheapestPrice: 6, borough: "Westminster",
  })];
  let positionReads = 0;
  const restaurants = [{
    id: "venue-osm-n101", name: "Rules", address: "35 Maiden Lane", kind: "restaurant" as const,
    borough: "Westminster", lng: -0.12319,
    get lat() { positionReads += 1; return 51.51083; },
  }, {
    id: "venue-osm-n102", name: "Another restaurant", address: "", kind: "restaurant" as const,
    borough: "Westminster", lat: 51.511, lng: -0.124,
  }];
  const community = new Map();
  const updates: Parameters<typeof usePublicPriceVenues>[2] = [];
  let drawn: readonly { id: string }[] = [];
  function RefreshedRestaurants({ drops }: { drops: Parameters<typeof usePublicPriceVenues>[1] }) {
    const canvasVenues = usePublicPriceVenues(baseVenues, drops, updates, "london", community);
    const restaurantsOnCanvas = useFilteredLondonRestaurants({
      restaurants, mode: "layer", baseVenues, canvasVenues,
      filters: initialFilters, savedOnly: false, nearMe: null, selectedVenueId: "",
    });
    useEffect(() => { drawn = restaurantsOnCanvas; }, [restaurantsOnCanvas]);
    return null;
  }
  await act(async () => root.render(createElement(RefreshedRestaurants, { drops: new Map() })));
  expect(drawn.map(row => row.id)).toEqual(["venue-osm-n102"]);
  expect(positionReads).toBeGreaterThan(0);
  const initialReads = positionReads;
  for (let refresh = 0; refresh < 2; refresh += 1) {
    await act(async () => root.render(createElement(RefreshedRestaurants, { drops: new Map() })));
    expect(drawn.map(row => row.id)).toEqual(["venue-osm-n102"]);
    expect(positionReads).toBe(initialReads);
  }
});

it("rechecks restaurant twins when visible membership or base geometry changes", async () => {
  const venue = slimVenueToPin({
    id: "venue-rules", name: "Rules", lat: 51.51083, lng: -0.12319,
    cheapestPrice: 6, borough: "Westminster",
  });
  const restaurants = [{
    id: "venue-osm-n101", name: "Rules", address: "35 Maiden Lane", kind: "restaurant" as const,
    borough: "Westminster", lat: 51.51083, lng: -0.12319,
  }];
  let drawn: readonly { id: string }[] = [];
  function Restaurants({ base, visible, selected = "" }: { base: Venue[]; visible: Venue[]; selected?: string }) {
    const restaurantsOnCanvas = useFilteredLondonRestaurants({
      restaurants, mode: "layer", baseVenues: base, canvasVenues: visible,
      filters: initialFilters, savedOnly: false, nearMe: null, selectedVenueId: selected,
    });
    useEffect(() => { drawn = restaurantsOnCanvas; }, [restaurantsOnCanvas]);
    return null;
  }
  const base = [venue];
  await act(async () => root.render(createElement(Restaurants, { base, visible: base })));
  expect(drawn).toEqual([]);
  await act(async () => root.render(createElement(Restaurants, { base, visible: [] })));
  expect(drawn).toEqual(restaurants);
  await act(async () => root.render(createElement(Restaurants, { base, visible: base })));
  expect(drawn).toEqual([]);
  await act(async () => root.render(createElement(Restaurants, { base, visible: base, selected: restaurants[0]!.id })));
  expect(drawn).toEqual(restaurants);
  const moved = [{ ...venue, latitude: 51.6 }];
  await act(async () => root.render(createElement(Restaurants, { base: moved, visible: moved })));
  expect(drawn).toEqual(restaurants);
  const renamed = [{ ...venue, name: "Different venue" }];
  await act(async () => root.render(createElement(Restaurants, { base: renamed, visible: renamed })));
  expect(drawn).toEqual(restaurants);
});

it("upgrades a one-place shared-link read to the full optional layer", async () => {
  const fetchMock = stubPack(() => "ok");
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true, selected: "venue-osm-n25496840" })));
  expect(container.querySelector("[data-count]")?.getAttribute("data-count")).toBe("1");
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/packs/"))).toHaveLength(1);
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));
  expect(Number(container.querySelector("[data-count]")?.getAttribute("data-count"))).toBeGreaterThan(1000);
});

it("keeps a completed full layer when an older selected-place response arrives late", async () => {
  let release: (() => void) | undefined;
  let firstChunk = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const body = readFileSync(join(ROOT, "public", String(input).replace(/^\//, "")), "utf8");
    if (String(input).includes("/packs/") && firstChunk) {
      firstChunk = false;
      await new Promise<void>(resolve => { release = resolve; });
    }
    return new Response(body, { status: 200 });
  });
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true, selected: "venue-osm-n25496840" })));
  expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("loading");
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));
  const fullCount = Number(container.querySelector("[data-count]")?.getAttribute("data-count"));
  expect(fullCount).toBeGreaterThan(1000);
  await act(async () => { release?.(); });
  expect(Number(container.querySelector("[data-count]")?.getAttribute("data-count"))).toBe(fullCount);
});

it("keeps a second shared-link selection while its different read settles", async () => {
  stubPack(() => "ok");
  const reject = vi.fn();
  function SharedLink() {
    const [selected, setSelected] = useState("venue-osm-n25496840");
    const read = useLondonRestaurants({ ...layerInput, selectedVenueId: selected });
    const pick = londonVenueSelection({ selectedVenueId: selected,
      coffee: { lensOn: false, status: "ready", byId: new Map<string, never>() },
      restaurants: { shown: Boolean(selected), status: read.status, byId: read.byId } });
    useReleaseLondonVenueSelection(pick.release, selected, reject, setSelected);
    return createElement("button", { "data-selected": selected, onClick: () => setSelected("venue-osm-n1784593689") }, pick.restaurant?.name ?? "");
  }
  await act(async () => root.render(createElement(SharedLink)));
  expect(container.querySelector("button")?.textContent).toBe("26 Furnival Street");
  await act(async () => container.querySelector("button")?.click());
  expect(reject).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.getAttribute("data-selected")).toBe("venue-osm-n1784593689");
  expect(container.querySelector("button")?.textContent).toBe("Tayyabs");
});

it("opens a selected place after a failed full-layer read without rejecting it", async () => {
  let response: "ok" | "down" = "down";
  const fetchMock = stubPack(() => response);
  const reject = vi.fn();
  function FailedFullRead() {
    const [selected, setSelected] = useState("");
    const read = useLondonRestaurants({ ...layerInput, restaurantKindVisible: true, selectedVenueId: selected });
    const pick = londonVenueSelection({ selectedVenueId: selected,
      coffee: { lensOn: false, status: "ready", byId: new Map<string, never>() },
      restaurants: { shown: read.mode !== "off", status: read.status, byId: read.byId } });
    useReleaseLondonVenueSelection(pick.release, selected, reject, setSelected);
    return createElement("button", {
      "data-selected": selected,
      "data-status": read.status,
      "data-count": read.restaurants.length,
      onClick: () => setSelected(selected === "venue-osm-n1784593689" ? "venue-osm-n25496840" : "venue-osm-n1784593689"),
    }, pick.restaurant?.name ?? "");
  }
  await act(async () => root.render(createElement(FailedFullRead)));
  expect(container.querySelector("button")?.getAttribute("data-status")).toBe("failed");
  response = "ok";
  await act(async () => container.querySelector("button")?.click());
  expect(reject).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.textContent).toBe("Tayyabs");
  expect(Number(container.querySelector("button")?.getAttribute("data-count"))).toBeGreaterThan(1000);
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/packs/"))).toHaveLength(6);
  await act(async () => container.querySelector("button")?.click());
  expect(reject).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.textContent).toBe("26 Furnival Street");
  expect(fetchMock.mock.calls.filter(([url]) => url === LONDON_RESTAURANT_PACK_PATH)).toHaveLength(2);
});

it("allows the same shared place to be retried after a failed read released it", async () => {
  let response: "ok" | "down" = "down";
  stubPack(() => response);
  const reject = vi.fn();
  function RetrySharedRead() {
    const [selected, setSelected] = useState("venue-osm-n1784593689");
    const read = useLondonRestaurants({ ...layerInput, selectedVenueId: selected });
    const pick = londonVenueSelection({ selectedVenueId: selected,
      coffee: { lensOn: false, status: "ready", byId: new Map<string, never>() },
      restaurants: { shown: Boolean(selected), status: read.status, byId: read.byId } });
    useReleaseLondonVenueSelection(pick.release, selected, reject, setSelected);
    return createElement("button", { "data-selected": selected, onClick: () => setSelected("venue-osm-n1784593689") }, pick.restaurant?.name ?? "");
  }
  await act(async () => root.render(createElement(RetrySharedRead)));
  expect(reject).toHaveBeenCalledTimes(1);
  expect(container.querySelector("button")?.getAttribute("data-selected")).toBe("");
  response = "ok";
  await act(async () => container.querySelector("button")?.click());
  expect(reject).toHaveBeenCalledTimes(1);
  expect(container.querySelector("button")?.textContent).toBe("Tayyabs");
});
