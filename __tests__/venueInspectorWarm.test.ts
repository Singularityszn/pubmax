// @vitest-environment jsdom

// THE VENUE PANEL'S CHUNK IS FETCHED ONCE THE PINS SHOW, NOT AT THE TAP.
//
// A tap fetched the panel's chunk behind the basemap tiles, and on Slow 4G it
// landed 4 to 12 s later. Fetched at the first idle moment after the pins
// show, it is in hand for most taps.

import { afterEach, expect, it, vi } from "vitest";

const inspectorLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/components/map/VenueInspector", () => {
  inspectorLoads.count += 1;
  return new Promise(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("waits for the pins, then fetches the chunk", async () => {
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    callback();
    return 0;
  });
  await import("@/components/map/LazyVenueInspector");
  expect(inspectorLoads.count).toBe(0);
  window.dispatchEvent(new Event("pubmax:pins-visible"));
  await vi.waitFor(() => expect(inspectorLoads.count).toBe(1));
});
