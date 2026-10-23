// @vitest-environment jsdom

// The London restaurant layer from the shell's side: the pack is read once,
// when it is first wanted, the drawn list is new only when the restaurants on
// it change, and the sheet a tapped restaurant opens says what the map knows
// and where that came from, and claims no price.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import LondonRestaurantSheet from "@/components/map/LondonRestaurantSheet";
import { useLondonRestaurants, useStableRestaurantList } from "@/components/map/useLondonRestaurants";
import { LONDON_RESTAURANT_PACK_PATH } from "@/lib/londonRestaurants";

const ROOT = resolve(__dirname, "..");

const container = document.createElement("div");
const root = createRoot(container);

function RestaurantLayer({ wanted }: { wanted: boolean }) {
  const read = useLondonRestaurants(wanted);
  const furnival = read.byId.get("venue-osm-n25496840");
  return createElement(
    "div",
    { "data-status": read.status, "data-count": read.restaurants.length },
    furnival ? createElement(LondonRestaurantSheet, { restaurant: furnival }) : null,
  );
}

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
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
  await settle();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("idle");

  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));
  await settle();
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: false })));
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));
  await settle();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(LONDON_RESTAURANT_PACK_PATH);
  const layer = container.querySelector("[data-status]");
  expect(layer?.getAttribute("data-status")).toBe("ready");
  expect(Number(layer?.getAttribute("data-count"))).toBeGreaterThan(1000);
});

it("asks again after a failed read the next time the layer is wanted", async () => {
  let state: "ok" | "down" = "down";
  const fetchMock = stubPack(() => state);

  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));
  await settle();
  expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("failed");

  state = "ok";
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: false })));
  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));
  await settle();

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe("ready");
});

it("opens a sheet that names the restaurant, says it serves alcohol and credits OpenStreetMap", async () => {
  stubPack(() => "ok");

  await act(async () => root.render(createElement(RestaurantLayer, { wanted: true })));
  await settle();

  const sheet = container.querySelector("[data-london-restaurant='venue-osm-n25496840']");
  expect(sheet?.querySelector("h2")?.textContent).toBe("26 Furnival Street");
  expect(sheet?.textContent).toContain("Restaurant");
  expect(sheet?.textContent).toContain("26, Furnival Street, London, EC4A 1JS");
  expect(sheet?.textContent).toContain("A restaurant that serves alcohol. We have no prices for it.");
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
