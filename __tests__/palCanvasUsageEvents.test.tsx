// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
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
}));

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
    getSource() { return undefined; }
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

import PubMapCanvas from "@/components/PubMapCanvas";
import { DEVICE_ACCOUNT_OWNER_KEY } from "@/lib/deviceAccountIdentity";
import { LOCAL_PAL_KEY } from "@/lib/localPal";
import { showLegRouteOnMap } from "@/lib/legRouteOnMap";
import type { LegOption } from "@/lib/legOptions";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import type { Venue } from "@/lib/venues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const route = [
  { id: "venue-a", name: "The Lamb", longitude: -0.1, latitude: 51.5 },
  { id: "venue-b", name: "The Crown", longitude: -0.09, latitude: 51.5 },
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

describe("canvas lead delivery under TRACKING_PLAN 5.7: one event per chosen way", () => {
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
    boundary.maps = [];
    boundary.placements = [];
    boundary.events = [];
    boundary.reducedMotion = false;
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
