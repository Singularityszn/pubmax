// @vitest-environment jsdom

// The London restaurant layer from the shell's side: the pack is read once,
// when it is first wanted, the drawn list is new only when the restaurants on
// it change, and the sheet a tapped restaurant opens says what the map knows
// and where that came from, and claims no price.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import LondonRestaurantSheet from "@/components/map/LondonRestaurantSheet";
import { useLondonRestaurants, useStableRestaurantList } from "@/components/map/useLondonRestaurants";
import { useReleaseLondonVenueSelection } from "@/components/map/useCoffeePilotCafes";
import { londonVenueSelection } from "@/lib/pubMap";
import { LONDON_RESTAURANT_PACK_PATH } from "@/lib/londonRestaurants";

const ROOT = resolve(__dirname, "..");

const container = document.createElement("div");
const root = createRoot(container);

function RestaurantLayer({ wanted, selected }: { wanted: boolean; selected?: string }) {
  const read = useLondonRestaurants(wanted, selected);
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
    const read = useLondonRestaurants(Boolean(selected), selected || undefined);
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
