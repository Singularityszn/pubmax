// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NearMeNow from "@/components/nearme/NearMeNow";
import NearDeskNow from "@/components/nearme/NearDeskNow";
import { readRememberedArea, writeRememberedArea } from "@/lib/nightPatches";
import type { PricedPoint } from "@/lib/nearMeAnswer";
import type { DeskVenueLoad } from "@/lib/nearDeskVenues";

const boundary = vi.hoisted(() => ({
  pathname: "/near",
  replace: vi.fn(), push: vi.fn(), slim: vi.fn(), desks: vi.fn(), track: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => boundary.pathname,
  useRouter: () => ({ replace: boundary.replace, push: boundary.push }),
}));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCity: boundary.slim }));
vi.mock("@/lib/nearDeskVenues", () => ({ loadDeskVenues: boundary.desks }));
vi.mock("@/lib/analytics", () => ({ trackEvent: boundary.track }));
vi.mock("@/components/nearme/useNearPriceTrust", () => ({ useNearPriceTrust: () => undefined }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const pints: PricedPoint[] = [{
  id: "test-pub", name: "Test Pub", lat: 51.5136, lng: -0.1365,
  cheapestPrice: 4, borough: "Westminster",
}];
const desks: DeskVenueLoad = {
  status: "ready", source: "osm", observedAt: "2026-10-08",
  venues: [{
    id: "test-desk", name: "Test Desk", lat: 51.5136, lng: -0.1365,
    kind: "cafe", wifi: "yes", laptop: "allowed", openingHours: null,
  }],
};

let host: HTMLDivElement;
let root: Root | null;
let slimRead: ReturnType<typeof deferred<PricedPoint[]>>;
let deskRead: ReturnType<typeof deferred<DeskVenueLoad>>;
let locations: Array<Parameters<Geolocation["getCurrentPosition"]>>;
let geolocate: ReturnType<typeof vi.fn<Geolocation["getCurrentPosition"]>>;
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/near?src=poster");
  localStorage.clear();
  vi.clearAllMocks();
  boundary.pathname = "/near";
  slimRead = deferred<PricedPoint[]>();
  deskRead = deferred<DeskVenueLoad>();
  boundary.slim.mockReturnValue(slimRead.promise);
  boundary.desks.mockReturnValue(deskRead.promise);
  locations = [];
  geolocate = vi.fn<Geolocation["getCurrentPosition"]>((...request) => {
    locations.push(request);
  });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: geolocate } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host.remove();
  vi.restoreAllMocks();
  if (originalGeolocation) Object.defineProperty(navigator, "geolocation", originalGeolocation);
  else Reflect.deleteProperty(navigator, "geolocation");
});

function render(mode: "pint" | "desk", patch = "soho", strict = false, autoLocate = false) {
  const surface = mode === "pint"
    ? createElement(NearMeNow, { initialPatchId: patch, syncPatchToUrl: true, showPriceTrust: true, autoLocate })
    : createElement(NearDeskNow, { initialPatchId: patch, syncPatchToUrl: true, autoLocate });
  act(() => root?.render(strict ? createElement(StrictMode, null, surface) : surface));
}

async function completeRead() {
  await act(async () => {
    slimRead.resolve(pints);
    deskRead.resolve(desks);
  });
}

describe("pint answer telemetry", () => {
  it("tracks only the newest patch when a superseded read completes", async () => {
    render("pint", "soho");
    render("pint", "camden");
    expect(boundary.track).not.toHaveBeenCalled();
    await completeRead();
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "camden" });
    expect(boundary.replace.mock.calls).toEqual([
      ["/near?src=poster&patch=camden", { scroll: false }],
    ]);
    expect(boundary.track.mock.calls).toEqual([
      ["near_answer_ready", { source: "picked-area", resultBand: "1-3" }],
    ]);
  });

  it("ignores an older location result after the selected patch answers", async () => {
    render("pint", "", false, true);
    expect(geolocate).toHaveBeenCalledOnce();
    render("pint", "soho", false, true);
    await completeRead();
    expect(boundary.track.mock.calls).toEqual([
      ["near_answer_ready", { source: "picked-area", resultBand: "1-3" }],
    ]);
    await act(async () => completeLocation("success"));
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "soho" });
    expect(boundary.track.mock.calls).toEqual([
      ["near_answer_ready", { source: "picked-area", resultBand: "1-3" }],
    ]);
    expect(boundary.replace).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Soho");
  });

  it("keeps a self-authored patch answer and tracks a coarse open before navigation", async () => {
    render("pint", "");
    const patchButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "Soho");
    if (!patchButton) throw new Error("Expected the Soho patch button");
    act(() => patchButton.click());
    const pint = pints[0];
    if (!pint) throw new Error("Expected a pint fixture");
    const rows = Array.from({ length: 5 }, (_, index) => ({
      ...pint, id: `private-pub-${index}`, name: `Pub ${index + 1}`,
      cheapestPrice: 4 + index / 10,
    }));
    await act(async () => slimRead.resolve(rows));
    expect(boundary.track.mock.calls).toEqual([
      ["near_answer_ready", { source: "picked-area", resultBand: "4+" }],
    ]);
    expect(boundary.replace).toHaveBeenCalledWith(
      "/near?src=poster&patch=soho", { scroll: false },
    );
    window.history.replaceState(null, "", "/near?src=poster&patch=soho");
    render("pint", "soho");
    expect(boundary.replace).toHaveBeenCalledOnce();
    expect(boundary.track).toHaveBeenCalledOnce();
    const venueButton = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Pub 2"));
    if (!venueButton) throw new Error("Expected the second pub button");
    act(() => venueButton.click());
    expect(boundary.track.mock.calls).toEqual([
      ["near_answer_ready", { source: "picked-area", resultBand: "4+" }],
      ["near_venue_opened", { source: "picked-area", positionBand: "2-3" }],
    ]);
    expect(boundary.push).toHaveBeenCalledWith("/map?sel=private-pub-1");
    const openedOrder = boundary.track.mock.invocationCallOrder[1];
    const navigationOrder = boundary.push.mock.invocationCallOrder[0];
    if (openedOrder === undefined) throw new Error("Expected the venue-open event call order");
    if (navigationOrder === undefined) throw new Error("Expected the navigation call order");
    expect(openedOrder).toBeLessThan(navigationOrder);
  });
});

describe.each(["pint", "desk"] as const)("%s answer ownership", (mode) => {
  it.each(["pathname exit before cleanup", "unmount"])("rejects a pending patch read after %s", async (exit) => {
    render(mode);
    expect(mode === "pint" ? boundary.slim : boundary.desks).toHaveBeenCalledOnce();
    if (exit === "unmount") {
      act(() => root?.unmount());
      root = null;
    } else {
      window.history.replaceState(null, "", "/");
    }
    await completeRead();
    expect(readRememberedArea()).toBeNull();
    expect(boundary.replace).not.toHaveBeenCalled();
    expect(boundary.track).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain(mode === "pint" ? "Test Pub" : "Test Desk");
  });

  it("keeps an active patch answer, poster query and event through Strict Mode replay", async () => {
    render(mode, "soho", true);
    await completeRead();
    expect(host.textContent).toContain(mode === "pint" ? "Test Pub" : "Test Desk");
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "soho" });
    expect(boundary.replace).toHaveBeenCalledWith(
      mode === "pint" ? "/near?src=poster&patch=soho" : "/near?src=poster&mode=desk&patch=soho",
      { scroll: false },
    );
    expect(boundary.track).toHaveBeenCalledOnce();
  });

  it.each(["success", "denied", "unavailable"] as const)("ignores late geolocation %s before and after cleanup", async (outcome) => {
    for (const unmount of [false, true]) {
      render(mode, "", false, true);
      expect(locations).toHaveLength(1);
      window.history.replaceState(null, "", "/");
      if (unmount) {
        act(() => root?.unmount());
        root = null;
      }
      act(() => completeLocation(outcome));
      await completeRead();
      expect(boundary.slim).not.toHaveBeenCalled();
      expect(boundary.desks).not.toHaveBeenCalled();
      expect(readRememberedArea()).toBeNull();
      expect(boundary.replace).not.toHaveBeenCalled();
      expect(boundary.track).not.toHaveBeenCalled();
      if (root) act(() => root?.unmount());
      root = createRoot(host);
      locations = [];
      window.history.replaceState(null, "", "/near?src=poster");
    }
  });

  it.each(["success", "denied", "unavailable"] as const)("keeps active geolocation %s through Strict Mode replay", async (outcome) => {
    render(mode, "", true, true);
    expect(geolocate).toHaveBeenCalledOnce();
    const request = geolocate.mock.calls[0];
    if (!request) throw new Error("Expected an active geolocation request");
    expect(request[2]).toEqual({ enableHighAccuracy: false, timeout: 7000, maximumAge: 60_000 });
    act(() => completeLocation(outcome));
    await completeRead();
    expect(host.textContent).toContain(mode === "pint" ? "Test Pub" : "Test Desk");
    expect(boundary.track).toHaveBeenCalledOnce();
    if (outcome === "success") {
      expect(readRememberedArea()).toBeNull();
      expect(boundary.replace).not.toHaveBeenCalled();
    } else {
      expect(readRememberedArea()).toEqual({ kind: "patch", id: "central" });
      expect(boundary.replace).toHaveBeenCalledOnce();
    }
  });

  it("lets a newer patch win over an older location request", async () => {
    render(mode, "", false, true);
    render(mode, "soho", false, true);
    await completeRead();
    act(() => completeLocation("denied"));
    await completeRead();
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "soho" });
    expect(boundary.replace).toHaveBeenCalledOnce();
    expect(boundary.track).toHaveBeenCalledOnce();
  });

  it("rejects a location answer whose pack finishes after route exit", async () => {
    render(mode, "", false, true);
    act(() => completeLocation("success"));
    expect(mode === "pint" ? boundary.slim : boundary.desks).toHaveBeenCalledOnce();
    window.history.replaceState(null, "", "/");
    await completeRead();
    expect(host.textContent).not.toContain(mode === "pint" ? "Test Pub" : "Test Desk");
    expect(boundary.track).not.toHaveBeenCalled();
    expect(boundary.replace).not.toHaveBeenCalled();
    expect(readRememberedArea()).toBeNull();
  });

  it("keeps the remembered patch when location is denied", async () => {
    writeRememberedArea({ kind: "patch", id: "soho" });
    render(mode, "", false, true);
    act(() => completeLocation("denied"));
    await completeRead();
    expect(host.textContent).toContain(mode === "pint" ? "Test Pub" : "Test Desk");
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "soho" });
    expect(boundary.replace).toHaveBeenCalledWith(
      mode === "pint" ? "/near?src=poster&patch=soho" : "/near?src=poster&mode=desk&patch=soho",
      { scroll: false },
    );
  });

  it("leaves bare Near idle and lets an explicit patch beat auto-location", async () => {
    render(mode, "");
    expect(geolocate).not.toHaveBeenCalled();
    expect(boundary.slim).not.toHaveBeenCalled();
    expect(boundary.desks).not.toHaveBeenCalled();
    render(mode, "soho", false, true);
    await completeRead();
    expect(geolocate).not.toHaveBeenCalled();
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "soho" });
  });
});

function completeLocation(outcome: "success" | "denied" | "unavailable") {
  const request = locations[0];
  if (!request) throw new Error("Expected a pending geolocation request");
  const [success, failure] = request;
  if (outcome === "success") {
    success({ coords: { latitude: 51.5136, longitude: -0.1365 } } as GeolocationPosition);
  } else {
    if (!failure) throw new Error("Expected a geolocation error callback");
    failure({ code: outcome === "denied" ? 1 : 2, PERMISSION_DENIED: 1 } as GeolocationPositionError);
  }
}

it("keeps the embedded Map answer browse-only", async () => {
  window.history.replaceState(null, "", "/map");
  boundary.pathname = "/map";
  await act(async () => root?.render(createElement(NearMeNow, {
    venues: pints, initialLocation: { lat: 51.5136, lng: -0.1365 }, syncPatchToUrl: false,
  })));
  expect(host.textContent).toContain("Test Pub");
  expect(geolocate).not.toHaveBeenCalled();
  expect(boundary.replace).not.toHaveBeenCalled();
  expect(readRememberedArea()).toBeNull();
});

it("keeps a remembered borough fallback without syncing a patch URL", async () => {
  writeRememberedArea({ kind: "borough", name: "Westminster" });
  render("pint", "", false, true);
  act(() => completeLocation("denied"));
  await completeRead();
  expect(host.textContent).toContain("Test Pub");
  expect(readRememberedArea()).toEqual({ kind: "borough", name: "Westminster" });
  expect(boundary.replace).not.toHaveBeenCalled();
  expect(boundary.track).toHaveBeenCalledOnce();
});
