// @vitest-environment jsdom
import { act, createElement, Fragment, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  maps: [] as Array<{
    emit: (event: string) => void;
    removed: boolean;
  }>,
  placements: [] as Array<[number, number]>,
  events: [] as Array<{ name: string; props: unknown }>,
  reducedMotion: false,
  pubsWrites: null as GeoJSON.FeatureCollection[] | null,
}));

const auth = vi.hoisted(() => ({ getCurrentUserId: (): string | null => auth.liveId, userId: "owner-a" as string | null, liveId: "owner-a" as string | null, loading: false }));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({ user: auth.userId ? { id: auth.userId } : null, loading: auth.loading, getCurrentUserId: auth.getCurrentUserId }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/map", useRouter: () => ({ prefetch() {} }) }));
vi.mock("@/components/pal/usePalHead3D", () => ({ usePalHead3D() {} }));
vi.mock("@/lib/authedFetch", async (original) => ({
  ...await original<typeof import("@/lib/authedFetch")>(),
  authedActionFetch: async () => new Response(null, { status: 503 }),
}));
// The map chip's age read is its own suite's (pubPalSummonOwnership); here the owner may have voice.
vi.mock("@/components/pubpal/usePalVoiceEligibility", () => ({ usePalVoiceEligibility: () => "eligible" }));
vi.mock("@/components/map/useCommunityPrices", () => ({ useCommunityPrices: () => ({}) }));
vi.mock("@/components/nearme/usePriceEvidenceMission", () => ({
  usePriceEvidenceMission: () => ({ mission: { venueId: "venue-a", reason: "missing" }, dismiss() {}, complete() {} }),
}));
vi.mock("@/components/nearme/PriceEvidenceMissionSlot", () => ({ default: () => null }));

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/analytics", () => ({
  trackEvent: (name: string, props?: unknown) => boundary.events.push({ name, props }),
}));
vi.mock("@/components/map/canvas/webgl", async (original) => ({
  ...await original<typeof import("@/components/map/canvas/webgl")>(),
  probeWebGl2: () => ({ hasContext: true, status: "" }),
  followMapPixelRatio: () => () => {},
}));
vi.mock("@/components/map/canvas/iconSprite", () => ({
  preloadMapIconSprite: () => {},
  resolveMissingMapIcon: () => false,
}));
vi.mock("@/components/map/canvas/buildScene", async (original) => ({
  ...await original<typeof import("@/components/map/canvas/buildScene")>(),
  assembleSceneCritical: () => {},
  assembleSceneDeferred: () => {},
}));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: () => {},
  NavigationControl: class {},
  Map: class {
    removed = false;
    private handlers = new Map<string, Set<() => void>>();
    private canvas = document.createElement("canvas");

    constructor(private options: { container: HTMLElement }) {
      boundary.maps.push(this);
    }
    on(event: string, ...args: unknown[]) {
      const listener = args.at(-1) as () => void;
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(listener);
      return this;
    }
    off(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.delete(args.at(-1) as () => void);
      return this;
    }
    once(event: string, listener: () => void) {
      const wrapped = () => { this.off(event, wrapped); listener(); };
      return this.on(event, wrapped);
    }
    emit(event: string) { for (const listener of [...this.handlers.get(event) ?? []]) listener(); }
    getContainer() { return this.options.container; }
    getCanvas() { return this.canvas; }
    getCenter() { return { lng: -0.1, lat: 51.5 }; }
    getZoom() { return 13; }
    getPitch() { return 0; }
    getBearing() { return 0; }
    getPadding() { return { top: 0, bottom: 0, left: 0, right: 0 }; }
    getStyle() { return { sources: {}, layers: [] }; }
    getLayer() { return undefined; }
    getSource(id: string) {
      if (id !== "pubs" || !boundary.pubsWrites) return undefined;
      return { setData: (data: GeoJSON.FeatureCollection) => boundary.pubsWrites!.push(data) };
    }
    getBounds() { return { getWest: () => -0.2, getEast: () => 0, getSouth: () => 51.4, getNorth: () => 51.6 }; }
    project() { return { x: 200, y: 300 }; }
    queryRenderedFeatures() { return []; }
    isStyleLoaded() { return true; }
    isSourceLoaded() { return true; }
    loaded() { return true; }
    areTilesLoaded() { return true; }
    isMoving() { return false; }
    isZooming() { return false; }
    isRotating() { return false; }
    addControl() {}
    resize() {}
    triggerRepaint() {}
    setMissingStyleImageResolver() {}
    fitBounds() {}
    easeTo() {}
    jumpTo() {}
    stop() {}
    remove() { this.removed = true; this.handlers.clear(); }
  },
  Marker: class {
    constructor(private options: { element: HTMLElement }) {}
    setLngLat(point: [number, number]) { boundary.placements.push(point); return this; }
    setOffset() { return this; }
    addTo(map: { getContainer: () => HTMLElement }) { map.getContainer().append(this.options.element); return this; }
    remove() { this.options.element.remove(); }
  },
  LngLatBounds: class {
    extend() { return this; }
    isEmpty() { return false; }
    toArray() { return [[-0.1, 51.5], [-0.09, 51.5]]; }
  },
}));

import VenuePintNeedle from "@/components/map/VenuePintNeedle";
import PalCheer from "@/components/pal/PalCheer";
import PalPostcard from "@/components/pal/PalPostcard";
import PalChatCompanion from "@/components/pal/PalChatCompanion";
import PubPalSummon from "@/components/pubpal/PubPalSummon";
import { PalMapEdgeButton } from "@/components/nav/PalNavButton";
import NearPriceEvidenceMission from "@/components/nearme/NearPriceEvidenceMission";
import PubMapCanvas from "@/components/PubMapCanvas";
import {
  bindDeviceAccountOwner,
  clearDeviceAccountSessionArtifacts,
  DEVICE_ACCOUNT_OWNER_KEY,
  emitDeviceIdentityChanged,
  releaseDeviceAccountOwner,
} from "@/lib/deviceAccountIdentity";
import { announceLocalPalChange, LOCAL_PAL_KEY } from "@/lib/localPal";
import { markActivePlan, readActivePlan, setActivePlanPalContext } from "@/lib/activePlan";
import { useActivePlanRoute, useActivePlanPalNextStop } from "@/components/map/pubmap/useActivePlanRoute";
import { readLegRouteOnMap, showLegRouteOnMap } from "@/lib/legRouteOnMap";
import type { LegOption } from "@/lib/legOptions";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import type { Venue } from "@/lib/venues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const route = [
  { id: "venue-a", name: "The Lamb", longitude: -0.1, latitude: 51.5, amenities: {} },
  { id: "venue-b", name: "The Crown", longitude: -0.09, latitude: 51.5, amenities: {} },
] as Venue[];
const way = (id: string): LegOption => ({
  id, kind: "walk", minutes: 6, farePence: 0, estimate: false, fastest: false, cheapest: true,
  parts: [{ mode: "walking", line: null, minutes: 6, path: [[-0.1, 51.5], [-0.09, 51.5]] }],
});
const props: ComponentProps<typeof PubMapCanvas> = {
  venues: [], route, venueDataReady: true, selectedVenueId: "",
  onVenueClick: () => {}, onRouteStopClick: () => {},
  palNextStop: { venueId: "venue-b", name: "The Crown" },
  openingCameraSettled: true, londonRestaurants: [],
  poisPath: null, transitLinesPath: null, hideLayersControl: true, ukBaseSuspended: true,
};

describe("canvas Pal delivery under TRACKING_PLAN 5.7 and F12 account isolation", () => {
  let root: Root;
  let host: HTMLElement;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let clock: number;

  async function frame() {
    await act(async () => {
      clock += 50;
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(clock);
    });
  }
  async function render(overrides: Partial<typeof props> = {}) {
    await act(async () => root.render(createElement(PubMapCanvas, { ...props, ...overrides })));
  }
  async function ready() {
    await act(async () => {
      boundary.maps.at(-1)!.emit("style.load");
      boundary.maps.at(-1)!.emit("render");
    });
    await frame();
  }
  const leads = () => boundary.events.filter(({ name }) => name === "pal_lead_started");
  async function choose(id: string) {
    await act(async () => showLegRouteOnMap({ legKey: "venue-a>venue-b", option: way(id) }));
  }

  beforeEach(() => {
    auth.userId = auth.liveId = "owner-a";
    auth.loading = false;
    boundary.maps = [];
    boundary.placements = [];
    boundary.events = [];
    boundary.reducedMotion = false;
    boundary.pubsWrites = null;
    frames = new Map();
    nextFrame = 0;
    clock = 0;
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: boundary.reducedMotion && query.includes("prefers-reduced-motion"),
      addEventListener() {}, removeEventListener() {},
    }));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {},
    });
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    window.localStorage.clear();
    window.localStorage.setItem(DEVICE_ACCOUNT_OWNER_KEY, "owner-a");
    const now = "2026-01-01T12:00:00.000Z";
    window.localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify({
      ...DEFAULT_PAL_DRAFT, id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", ownerId: "owner-a", name: "Ripley",
      adultAttestedAt: now, muted: false, hidden: false, proposalPreferences: {}, masteryPoints: 0,
      createdAt: now, updatedAt: now,
    }));
    markActivePlan("11111111-1111-4111-8111-111111111111", new Date().toISOString(), Date.now(), "owner-a");
    showLegRouteOnMap(null);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    showLegRouteOnMap(null);
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // The cold-load contract requires a source write after scene readiness,
  // even when the venue array did not change. Losing it delays the pin reveal.
  it.each(["before", "after"] as const)("sends venue data that arrives %s map readiness to the pubs source", async (arrival) => {
    await render({ venues: [], venueDataReady: false });
    if (arrival === "before") {
      await render({ venues: route, venueDataReady: true });
    }
    boundary.pubsWrites = [];
    await ready();
    if (arrival === "after") {
      boundary.pubsWrites.length = 0;
      await render({ venues: route, venueDataReady: true });
    }
    expect(boundary.pubsWrites).toHaveLength(1);
    expect(boundary.pubsWrites[0]?.features).toEqual([
      expect.objectContaining({ geometry: { type: "Point", coordinates: [-0.1, 51.5] }, properties: expect.objectContaining({ id: "venue-a" }) }),
      expect.objectContaining({ geometry: { type: "Point", coordinates: [-0.09, 51.5] }, properties: expect.objectContaining({ id: "venue-b" }) }),
    ]);
  });

  it("emits on placement, retains the count across rebuilds, and counts a new choice", async () => {
    await render();
    await ready();
    await choose("walk");
    expect(leads()).toHaveLength(0);
    const before = boundary.placements.length;
    await frame();
    expect(boundary.placements.length).toBeGreaterThan(before);
    expect(leads()).toEqual([{ name: "pal_lead_started", props: undefined }]);
    await frame();
    expect(leads()).toHaveLength(1);
    await choose("walk");
    await frame();
    expect(leads()).toHaveLength(1);

    await render({ cityId: "manchester" });
    expect(boundary.maps).toHaveLength(2);
    expect(boundary.maps[0]!.removed).toBe(true);
    await ready();
    await frame();
    expect(host.querySelector(".palMapMarker")).not.toBeNull();
    expect(leads()).toHaveLength(1);

    await choose("scenic-walk");
    await frame();
    expect(leads()).toHaveLength(2);
    await frame();
    expect(leads()).toHaveLength(2);
  });

  it.each(["same-tab switch", "cross-tab switch", "sign-out", "provider sign-out"])(
    "retires the own marker and its actions under F12 after %s without rebuilding the map",
    async (transition) => {
      boundary.reducedMotion = true;
      const openStop = vi.fn();
      await render({ onRouteStopClick: openStop });
      await ready();
      const marker = host.querySelector<HTMLElement>(".palMapMarker")!;
      expect(marker.getAttribute("aria-label")).toBe("Next stop: The Crown");
      marker.click();
      expect(openStop).toHaveBeenCalledExactlyOnceWith("venue-b");
      openStop.mockClear();

      await act(async () => emitDeviceIdentityChanged());
      expect(host.querySelector(".palMapMarker")).toBe(marker);

      await act(async () => {
        if (transition === "provider sign-out") {
          auth.userId = auth.liveId = null;
        } else if (transition === "sign-out") {
          auth.userId = auth.liveId = null;
          releaseDeviceAccountOwner(window.localStorage, window.sessionStorage);
        } else {
          if (transition === "same-tab switch") auth.userId = auth.liveId = "owner-b";
          bindDeviceAccountOwner("owner-b", window.localStorage, window.sessionStorage);
        }
        if (transition === "cross-tab switch") {
          window.dispatchEvent(new StorageEvent("storage", { key: DEVICE_ACCOUNT_OWNER_KEY }));
        } else {
          emitDeviceIdentityChanged();
        }
      });
      expect(host.querySelector(".palMapMarker")).toBeNull();
      expect(marker.isConnected).toBe(false);
      marker.click();
      marker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      marker.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      expect(openStop).not.toHaveBeenCalled();

      await render({ selectedVenueId: "venue-a", onRouteStopClick: openStop });
      await choose("walk");
      await frame();
      await render({ route: [], venues: route, selectedVenueId: "venue-b", onRouteStopClick: openStop });
      await frame();
      expect(host.querySelector(".palMapMarker")).toBeNull();
      expect(leads()).toHaveLength(0);
      expect(boundary.maps).toHaveLength(1);
      expect(boundary.maps[0]!.removed).toBe(false);
    },
  );

  it.each(["switch", "provider sign-out"])("retires A's chosen path before B activates the same leg after %s", async (transition) => {
    boundary.reducedMotion = true;
    await render();
    await ready();
    await choose("walk");
    expect(readLegRouteOnMap()?.option.id).toBe("walk");
    expect(leads()).toHaveLength(1);
    const oldPal = JSON.parse(localStorage.getItem(LOCAL_PAL_KEY)!);
    if (transition === "provider sign-out") {
      await act(async () => {
        auth.userId = auth.liveId = null;
        clearDeviceAccountSessionArtifacts(sessionStorage);
        emitDeviceIdentityChanged();
      });
      expect(readLegRouteOnMap()).toBeNull();
      expect(host.querySelector(".palMapMarker")).toBeNull();
    }
    await act(async () => {
      auth.userId = auth.liveId = "owner-b";
      bindDeviceAccountOwner("owner-b", localStorage, sessionStorage);
      localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify({ ...oldPal, id: "pal-b", ownerId: "owner-b", name: "Moss" }));
      markActivePlan("22222222-2222-4222-8222-222222222222", new Date().toISOString(), Date.now(), "owner-b");
      emitDeviceIdentityChanged();
      announceLocalPalChange();
    });
    await render();
    await frame();
    expect(readLegRouteOnMap()).toBeNull();
    expect(host.querySelector(".palMapMarker")?.getAttribute("aria-label")).toBe("Next stop: The Crown");
    expect(leads()).toHaveLength(1);
    await choose("walk");
    expect(leads()).toHaveLength(2);
    expect(boundary.maps).toHaveLength(1);
  });

  it.each(["account switch", "provider sign-out"])(
    "isolates every mounted cached Pal consumer on /map after %s under F12",
    async (transition) => {
      boundary.reducedMotion = true;
      const openStop = vi.fn();
      const consumers = () => createElement(Fragment, null,
        createElement(PubMapCanvas, { ...props, onRouteStopClick: openStop }),
        createElement(VenuePintNeedle, { venueId: "venue-xjf3n0", priceGbp: 5 }),
        createElement(PalCheer, { moment: "crawl-finished", stops: 2 }),
        createElement(PalPostcard, { stops: ["The Lamb", "The Crown"], title: "The night", completedAt: null }),
        createElement(PalMapEdgeButton, { pathname: "/map" }),
        createElement(PubPalSummon),
        createElement(PalChatCompanion, { owner: auth.userId, state: "idle" }),
        createElement(NearPriceEvidenceMission, { cards: route as unknown as ComponentProps<typeof NearPriceEvidenceMission>["cards"], enabled: true }),
      );
      const renderConsumers = () => act(async () => root.render(consumers()));
      const assertPersonal = (name: string | null) => {
        expect(Boolean(host.querySelector(".venuePintNeedlePal"))).toBe(name !== null);
        expect(host.querySelector(".palCheer")?.textContent ?? "").toBe(name ? `${name} walked all 2 stops with you.` : "");
        expect(host.querySelector(".mobileMapPalDoor")?.getAttribute("aria-label")).toBe(name ? `Pub Pal, ${name}` : "Pub Pal");
        expect(host.querySelector(".palSummon")?.getAttribute("aria-label") ?? null).toBe(name ? `Summon ${name}, your Pub Pal` : null);
        expect(host.querySelector(".palPostcardHeading")?.textContent ?? null).toBe(name ? `A postcard from ${name}` : null);
        expect(Boolean(host.querySelector(".palChatCompanion [data-genome]"))).toBe(name !== null);
        const quest = host.querySelector("[data-testid='pal-quest']");
        if (name) expect(quest?.textContent).toContain(name);
        else expect(quest).toBeNull();
      };
      await renderConsumers();
      await ready();
      assertPersonal("Ripley");
      const oldMarker = host.querySelector<HTMLElement>(".palMapMarker")!;
      expect(oldMarker.getAttribute("aria-label")).toBe("Next stop: The Crown");
      oldMarker.click();
      expect(openStop).toHaveBeenCalledExactlyOnceWith("venue-b");
      openStop.mockClear();
      const cachedA = localStorage.getItem(LOCAL_PAL_KEY)!;
      await act(async () => {
        auth.liveId = transition === "account switch" ? "owner-b" : null;
        if (transition === "account switch") localStorage.setItem(DEVICE_ACCOUNT_OWNER_KEY, "owner-b");
        emitDeviceIdentityChanged();
      });
      assertPersonal(null);
      expect(host.querySelector(".palMapMarker")).toBeNull();
      expect(oldMarker.isConnected).toBe(false);
      oldMarker.click();
      oldMarker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      oldMarker.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      expect(openStop).not.toHaveBeenCalled();
      expect(localStorage.getItem(LOCAL_PAL_KEY)).toBe(cachedA);
      if (transition === "provider sign-out") expect(localStorage.getItem(DEVICE_ACCOUNT_OWNER_KEY)).toBe("owner-a");
      auth.userId = auth.liveId;
      await renderConsumers();
      assertPersonal(null);
      if (transition === "account switch") {
        await act(async () => {
          localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify({ ...JSON.parse(cachedA), id: "pal-b", ownerId: "owner-b", name: "Moss" }));
          announceLocalPalChange();
        });
        assertPersonal("Moss");
        const newMarker = host.querySelector<HTMLElement>(".palMapMarker")!;
        expect(newMarker).not.toBe(oldMarker);
        expect(newMarker.getAttribute("aria-label")).not.toBe("Next stop: The Crown");
        newMarker.click();
        expect(openStop).not.toHaveBeenCalled();
      }
      await choose("walk");
      await frame();
      expect(boundary.maps).toHaveLength(1);
      expect(boundary.maps[0]!.removed).toBe(false);
    },
  );

  it("retires account A's map route and actions when B opens Pal and returns", async () => {
    boundary.reducedMotion = true;
    const openStop = vi.fn();
    const planId = "11111111-1111-4111-8111-111111111111";
    const stops = route.map((v, position) => ({ venueId: v.id, venueName: v.name, position }));
    vi.mocked(fetch).mockImplementation(async (input) => new Response(JSON.stringify(
      String(input) === `/api/plans/${planId}` ? { stops } : {},
    ), { status: String(input) === `/api/plans/${planId}` ? 200 : 503 }));
    function MapJourney() {
      const activeStops = useActivePlanRoute();
      const activeRoute = activeStops.map(stop => route.find(v => v.id === stop.venueId)!);
      const { palNextStop } = useActivePlanPalNextStop(activeStops, activeRoute, false, new Map(route.map(v => [v.id, v])));
      return createElement(Fragment, null,
        createElement("output", { "data-testid": "retained-route" }, activeStops.map(stop => stop.venueId).join(",")),
        createElement(PubMapCanvas, { ...props, route: activeRoute, palNextStop, onRouteStopClick: openStop }),
        createElement(PubPalSummon),
      );
    }
    await act(async () => root.render(createElement(MapJourney)));
    await ready();
    expect(host.querySelector("output")?.textContent).toBe("venue-a,venue-b");
    const oldMarker = host.querySelector<HTMLElement>(".palMapMarker")!;
    expect(oldMarker.getAttribute("aria-label")).toBe("Next stop: The Crown");
    oldMarker.click();
    expect(openStop).toHaveBeenCalledExactlyOnceWith("venue-b");
    openStop.mockClear();
    const oldPal = JSON.parse(localStorage.getItem(LOCAL_PAL_KEY)!);
    await act(async () => {
      auth.userId = auth.liveId = "owner-b";
      bindDeviceAccountOwner("owner-b", localStorage, sessionStorage);
      localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify({ ...oldPal, id: "pal-b", ownerId: "owner-b", name: "Moss" }));
      setActivePlanPalContext({ id: "pal-b", name: "Moss" }, "owner-b");
      emitDeviceIdentityChanged();
      announceLocalPalChange();
    });
    await act(async () => root.render(createElement(MapJourney)));
    await choose("walk");
    await frame();
    expect(readActivePlan()?.ownerId).toBe("owner-a");
    expect(host.querySelector("output")?.textContent).toBe("");
    expect(host.querySelector(".palSummon small")?.textContent).not.toContain("Stop");
    expect(host.querySelector("[aria-label='Next stop: The Crown']")).toBeNull();
    oldMarker.click();
    expect(openStop).not.toHaveBeenCalled();
    expect(leads()).toHaveLength(0);
    expect(boundary.maps).toHaveLength(1);
    expect(boundary.maps[0]!.removed).toBe(false);
  });

  it.each(["signed-out", "loading"])("creates no own marker for a %s account with a retained cache", async (state) => {
    if (state === "signed-out") auth.userId = auth.liveId = null;
    else auth.loading = true;
    await render();
    await ready();
    await choose("walk");
    await frame();
    expect(host.querySelector(".palMapMarker")).toBeNull();
    expect(leads()).toHaveLength(0);
  });

  it("does not count a choice cancelled before placement", async () => {
    await render();
    await ready();
    await choose("walk");
    await act(async () => showLegRouteOnMap(null));
    await frame();
    expect(leads()).toHaveLength(0);
    await choose("walk");
    await frame();
    expect(leads()).toHaveLength(1);
  });

  it.each(["muted", "reduced motion"])("counts stationary placement once with %s", async (state) => {
    if (state === "muted") {
      const pal = JSON.parse(window.localStorage.getItem(LOCAL_PAL_KEY)!);
      window.localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify({ ...pal, muted: true }));
    } else boundary.reducedMotion = true;
    await render();
    await ready();
    await choose("walk");
    expect(leads()).toEqual([{ name: "pal_lead_started", props: undefined }]);
    await frame();
    expect(leads()).toHaveLength(1);
  });

  it.each(["missing", "hidden"])("does not count a %s Pal", async (state) => {
    if (state === "missing") window.localStorage.removeItem(LOCAL_PAL_KEY);
    else {
      const pal = JSON.parse(window.localStorage.getItem(LOCAL_PAL_KEY)!);
      window.localStorage.setItem(LOCAL_PAL_KEY, JSON.stringify({ ...pal, hidden: true }));
    }
    await render();
    await ready();
    await choose("walk");
    await frame();
    expect(host.querySelector(".palMapMarker")).toBeNull();
    expect(leads()).toHaveLength(0);
  });
});
