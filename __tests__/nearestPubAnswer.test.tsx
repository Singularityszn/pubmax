// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NearMeNow, { type NearMeNowProps } from "@/components/nearme/NearMeNow";
import type { PricedPoint } from "@/lib/nearMeAnswer";
import { readRememberedArea } from "@/lib/nightPatches";

const boundary = vi.hoisted(() => ({
  pathname: "/near", push: vi.fn(), replace: vi.fn(), slim: vi.fn(), track: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => boundary.pathname,
  useRouter: () => ({ push: boundary.push, replace: boundary.replace }),
}));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCity: boundary.slim }));
vi.mock("@/lib/analytics", () => ({ trackEvent: boundary.track }));

const HERE = { lat: 51.5136, lng: -0.1365 };
const MOVED = { lat: HERE.lat + 0.003, lng: HERE.lng };
// A listed price is shown only with its source and read day.
const EVIDENCE = { priceSource: "Pub menu", priceObservedAt: "2026-01-01" } as const;
const VENUES: PricedPoint[] = [
  { id: "spoons", name: "The Example - JD Wetherspoon", lat: HERE.lat + 0.002, lng: HERE.lng, cheapestPrice: 3.2, borough: "Westminster", ...EVIDENCE },
  { id: "unpriced", name: "The Nearest Local", lat: HERE.lat + 0.0001, lng: HERE.lng, cheapestPrice: null, borough: "Westminster" },
  { id: "expensive", name: "The Expensive Pub", lat: HERE.lat + 0.001, lng: HERE.lng, cheapestPrice: 7, borough: "Westminster", ...EVIDENCE },
  { id: "middle", name: "The Other Pub", lat: MOVED.lat, lng: MOVED.lng, cheapestPrice: 5, borough: "Westminster", ...EVIDENCE },
  { id: "cafe", name: "The Nearest Cafe", lat: HERE.lat, lng: HERE.lng, cheapestPrice: 2, borough: "Westminster", kind: "cafe", ...EVIDENCE },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let host: HTMLDivElement;
let root: Root | null;
let slimRead: ReturnType<typeof deferred<PricedPoint[]>>;
let locations: Array<Parameters<Geolocation["getCurrentPosition"]>>;
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/near");
  localStorage.clear();
  vi.clearAllMocks();
  boundary.pathname = "/near";
  locations = [];
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (...request: Parameters<Geolocation["getCurrentPosition"]>) => locations.push(request) },
  });
  slimRead = deferred<PricedPoint[]>();
  boundary.slim.mockReturnValue(slimRead.promise);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
  if (originalGeolocation) Object.defineProperty(navigator, "geolocation", originalGeolocation);
  else Reflect.deleteProperty(navigator, "geolocation");
});

async function render(props: Partial<NearMeNowProps> = {}) {
  await act(async () => {
    root?.render(createElement(NearMeNow, { venues: VENUES, initialLocation: HERE, ...props }));
  });
}

function nearestRegion() {
  return host.querySelector<HTMLElement>('section[aria-label="Nearest listed pub"]');
}

function nearest() {
  const region = nearestRegion();
  if (!region) throw new Error("Expected a visible nearest-pub result");
  return region;
}

function button(text: string) {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!found) throw new Error(`Expected button: ${text}`);
  return found;
}

function completeFix(index: number, point = HERE) {
  const request = locations[index];
  if (!request) throw new Error(`Expected geolocation request ${index}`);
  request[0]({ coords: { latitude: point.lat, longitude: point.lng } } as GeolocationPosition);
}

function failFix(index: number, outcome: "denied" | "unavailable") {
  const failure = locations[index]?.[1];
  if (!failure) throw new Error(`Expected geolocation failure callback ${index}`);
  failure({ code: outcome === "denied" ? 1 : 2, PERMISSION_DENIED: 1 } as GeolocationPositionError);
}

describe("nearest pub beside listed pint prices", () => {
  // Near supplies its city index. Map supplies its filtered pubs. Neither
  // interface promises the nearest venue across every UK base listing.
  it("shows a nearer unpriced pub while the pint list remains cheapest first", async () => {
    await render();
    expect(nearest().textContent).toContain("The Nearest Local");
    expect(nearest().textContent).toContain("About 1 min");
    expect(nearest().textContent).toContain("right here");
    expect(nearest().textContent).not.toContain("£");

    const list = Array.from(host.querySelectorAll("ul"))
      .find((candidate) => candidate.textContent?.includes("£3.20"));
    if (!list) throw new Error("Expected the listed pint prices");
    expect(Array.from(list.children).map((row) => row.querySelector("button")?.textContent))
      .toEqual([
        expect.stringContaining("The Example - JD Wetherspoon"),
        expect.stringContaining("The Other Pub"),
        expect.stringContaining("The Expensive Pub"),
      ]);
    expect(list.textContent).not.toContain("The Nearest Local");
    expect(nearest().textContent).not.toContain("The Nearest Cafe");
  });

  it("opens the nearest pub by its exact venue ID", async () => {
    await render();
    const open = nearest().querySelector("button");
    if (!open) throw new Error("Expected View pub for the nearest result");
    expect(open.textContent).toContain("View pub");
    act(() => open.click());
    expect(boundary.push).toHaveBeenCalledWith("/map?sel=unpriced");
    expect(boundary.push).toHaveBeenCalledTimes(1);
  });

  it("keeps the embedded Map result browse-only and uses its selection callback", async () => {
    boundary.pathname = "/map";
    window.history.replaceState(null, "", "/map");
    const onSelectVenue = vi.fn();
    await render({ onSelectVenue, titledByHost: true });
    const open = nearest().querySelector("button");
    if (!open) throw new Error("Expected the nearest-pub browse control");
    act(() => open.click());
    expect(onSelectVenue).toHaveBeenCalledWith("unpriced");
    expect(boundary.push).not.toHaveBeenCalled();
    expect(nearest().querySelectorAll("button")).toHaveLength(1);
    expect(nearest().textContent).not.toContain("Keep for tonight");
  });

  it("still shows the nearest pub when no pint price is listed anywhere", async () => {
    const unpriced = VENUES.filter((venue) => venue.id === "unpriced");
    await render({ venues: unpriced, initialLocation: null, autoLocate: true });
    await act(async () => completeFix(0));
    expect(nearest().textContent).toContain("The Nearest Local");
    expect(nearest().textContent).not.toContain("£");
    expect(host.textContent).toContain("We don't have priced pubs right where you are yet.");
    expect(boundary.push).not.toHaveBeenCalled();
  });

  it("replaces the nearest result when the supplied reader location changes", async () => {
    await render();
    expect(nearest().textContent).toContain("The Nearest Local");
    await render({ initialLocation: MOVED });
    expect(nearest().textContent).toContain("The Other Pub");
    expect(nearest().textContent).not.toContain("The Nearest Local");
  });

  it("ranks only the caller's supplied pub list without loading a wider index", async () => {
    await render({ venues: VENUES.filter((venue) => venue.id !== "unpriced") });
    expect(nearest().textContent).toContain("The Expensive Pub");
    expect(nearest().textContent).not.toContain("The Nearest Local");
    expect(boundary.slim).not.toHaveBeenCalled();
  });

  it("restores a located nearest result when the reader retries location from an area answer", async () => {
    await render({ initialLocation: null, initialPatchId: "soho" });
    expect(nearestRegion()).toBeNull();
    act(() => button("Try my location again").click());
    await act(async () => completeFix(0, MOVED));
    expect(nearest().textContent).toContain("The Other Pub");
  });

  it.each(["denied", "unavailable"] as const)(
    "removes the previous nearest result while locating and after location becomes %s",
    async (outcome) => {
      await render();
      expect(nearest().textContent).toContain("The Nearest Local");
      await act(async () => button("Update location").click());
      expect(nearestRegion()).toBeNull();
      await act(async () => failFix(0, outcome));
      expect(nearestRegion()).toBeNull();
      expect(readRememberedArea()).toEqual({ kind: "patch", id: "central" });
    },
  );

  it("does not replace a newer location with an older request's late answer", async () => {
    await render();
    const update = button("Update location");
    act(() => { update.click(); update.click(); });
    expect(locations).toHaveLength(2);
    expect(nearestRegion()).toBeNull();
    await act(async () => completeFix(1, MOVED));
    expect(nearest().textContent).toContain("The Other Pub");
    await act(async () => completeFix(0, HERE));
    expect(nearest().textContent).toContain("The Other Pub");
    expect(nearest().textContent).not.toContain("The Nearest Local");
  });

  it("hides the located result after an explicit area choice and ignores its late location callback", async () => {
    await render();
    act(() => button("Update location").click());
    await render({ initialLocation: null, initialPatchId: "soho" });
    expect(nearestRegion()).toBeNull();
    expect(host.textContent).toContain("Cheapest listed around Soho");
    await act(async () => completeFix(0, MOVED));
    expect(nearestRegion()).toBeNull();
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "soho" });
  });

  it("rejects a delayed venue read after an area choice supersedes location", async () => {
    await render({ venues: undefined, initialLocation: null, autoLocate: true });
    act(() => completeFix(0));
    await render({ venues: undefined, initialLocation: null, initialPatchId: "soho" });
    await act(async () => slimRead.resolve(VENUES));
    expect(nearestRegion()).toBeNull();
    expect(host.textContent).toContain("Cheapest listed around Soho");
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "soho" });
  });

  it.each(["route exit", "unmount"])("rejects a delayed nearest result after %s", async (exit) => {
    await render({ venues: undefined, initialLocation: null, autoLocate: true });
    act(() => completeFix(0));
    if (exit === "unmount") {
      act(() => root?.unmount());
      root = null;
    } else {
      window.history.replaceState(null, "", "/today");
    }
    await act(async () => slimRead.resolve(VENUES));
    expect(nearestRegion()).toBeNull();
    expect(host.textContent).not.toContain("The Nearest Local");
    expect(boundary.push).not.toHaveBeenCalled();
    expect(readRememberedArea()).toBeNull();
  });

  it("keeps bare Near and an explicit patch from claiming to know the nearest pub", async () => {
    await render({ initialLocation: null });
    expect(nearestRegion()).toBeNull();
    expect(locations).toHaveLength(0);
    await render({ initialLocation: null, initialPatchId: "soho", autoLocate: true });
    expect(nearestRegion()).toBeNull();
    expect(locations).toHaveLength(0);
  });
});
