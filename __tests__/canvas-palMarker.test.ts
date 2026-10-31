// @vitest-environment jsdom
import type * as maplibregl from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markerHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    options: { element: HTMLElement; anchor?: string; offset?: [number, number] };
    lngLat: [number, number] | null;
    remove: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("maplibre-gl", () => ({
  Marker: class {
    remove = vi.fn();

    lngLat: [number, number] | null = null;

    constructor(public options: { element: HTMLElement; anchor?: string; offset?: [number, number] }) {
      markerHarness.instances.push(this);
    }

    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }

    setOffset(offset: [number, number]) {
      this.options.offset = offset;
      return this;
    }

    addTo() {
      return this;
    }
  },
}));

import { createPalMapMarker, palMarkerElement, palPinIsCheap } from "@/components/map/canvas/palMarker";
import { palWalkPlan, type LngLat } from "@/components/map/canvas/palWalk";
import { announcePalMoment } from "@/lib/palMoments";
import type { PubPal } from "@/lib/pubPal";

const map = {} as maplibregl.Map;

function pal(overrides: Partial<PubPal> = {}): PubPal {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    ownerId: "owner",
    name: "Ada",
    adultAttestedAt: now,
    appearance: { species: "robin", signalAffinity: "pint", material: "hologram", accessory: "none" },
    personality: { energy: 50, playfulness: 50, storytelling: 50, relationship: "guide" },
    voice: { id: "warm" },
    muted: false,
    hidden: false,
    proposalPreferences: {},
    masteryPoints: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as PubPal;
}

function store(value: unknown) {
  window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(value));
}

// A frame clock the test turns by hand.
let frames: Array<(now: number) => void> = [];
let clock = 0;
function runFrames(count: number, stepMs = 50) {
  for (let index = 0; index < count && frames.length; index += 1) {
    clock += stepMs;
    const due = frames;
    frames = [];
    for (const callback of due) callback(clock);
  }
}

function reducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce") }));
}

beforeEach(() => {
  markerHarness.instances.length = 0;
  window.localStorage.clear();
  frames = [];
  clock = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  reducedMotion(false);
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const crawl: LngLat[] = [[-0.1, 51.5], [-0.09, 51.5], [-0.095, 51.505]];
const crawlKey = crawl.map((stop) => stop.join(",")).join(";");

describe("the Pal on the map", () => {
  it("makes no marker without a stored Pal, or for one the reader hid", () => {
    createPalMapMarker(map).perch([-0.1, 51.5]);
    store(pal({ hidden: true }));
    createPalMapMarker(map).perch([-0.1, 51.5]);
    store({ id: "pal-e2e", appearance: {} });
    createPalMapMarker(map).perch([-0.1, 51.5]);
    expect(markerHarness.instances).toHaveLength(0);
  });

  it("is a decorative avatar held by the Pal genome", () => {
    const element = palMarkerElement(pal())!;
    expect(element.getAttribute("aria-hidden")).toBe("true");
    expect(element.querySelectorAll("a, button")).toHaveLength(0);
    const image = element.querySelector("img")!;
    expect(image.getAttribute("src")).toMatch(/avatar.*64.*\.webp$/);
    expect(image.alt).toBe("");
    // The talking frame lies on the same avatar, decorative and shut.
    const mouth = element.querySelector<HTMLImageElement>("img.palMapMarkerMouth")!;
    expect(mouth.getAttribute("src")).toBe("/pal/circuit-robin-talk-avatar-64.webp");
    expect(mouth.alt).toBe("");
    expect(mouth.parentElement).toBe(image.parentElement);
    const body = element.querySelector<HTMLElement>(".palMapMarkerBody")!;
    expect(body.style.getPropertyValue("--genome-zoom")).not.toBe("");
  });

  it("sleeps with a muted Pal", () => {
    expect(palMarkerElement(pal({ muted: true }))!.dataset.palState).toBe("sleeping");
    expect(palMarkerElement(pal())!.dataset.palState).toBeUndefined();
  });

  it("perches beside the pin, hops to a new one, and steps off with no selection", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.perch([-0.1, 51.5]);
    expect(markerHarness.instances).toHaveLength(1);
    const [instance] = markerHarness.instances;
    expect(instance!.options.anchor).toBe("bottom-left");
    expect(instance!.lngLat).toEqual([-0.1, 51.5]);
    expect(instance!.options.element.classList.contains("isLanding")).toBe(true);

    marker.perch([-0.12, 51.51]);
    expect(markerHarness.instances).toHaveLength(1);
    expect(instance!.lngLat).toEqual([-0.12, 51.51]);

    marker.perch(null);
    expect(instance!.remove).toHaveBeenCalledTimes(1);
    marker.perch([-0.12, 51.51]);
    expect(markerHarness.instances).toHaveLength(2);
    marker.destroy();
    expect(markerHarness.instances[1]!.remove).toHaveBeenCalledTimes(1);
  });

  it("reads the band the pin itself paints: the Spoons value band first, else the price bucket", () => {
    expect(palPinIsCheap({ bucket: 0 })).toBe(true);
    expect(palPinIsCheap({ bucket: 1 })).toBe(false);
    expect(palPinIsCheap({ bucket: 3 })).toBe(false);
    expect(palPinIsCheap({ bucket: 2, spoonsBucket: 0 })).toBe(true);
    expect(palPinIsCheap({ bucket: 0, spoonsBucket: 2 })).toBe(false);
    expect(palPinIsCheap({ bucket: "0" })).toBe(false);
    expect(palPinIsCheap({})).toBe(false);
    expect(palPinIsCheap(undefined)).toBe(false);
  });

  it("lands with a happy hop beside a cheap pin, and a plain landing beside any other", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.perch([-0.1, 51.5], { cheap: true });
    const element = markerHarness.instances[0]!.options.element;
    expect(element.classList.contains("isCheering")).toBe(true);
    expect(element.dataset.palPin).toBe("cheap");

    marker.perch([-0.12, 51.51], { cheap: false });
    expect(element.classList.contains("isCheering")).toBe(false);
    expect(element.classList.contains("isLanding")).toBe(true);
    expect(element.dataset.palPin).toBeUndefined();
    marker.destroy();
  });

  it("lands again when the pin it stands beside changes band", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.perch([-0.1, 51.5], { cheap: false });
    const element = markerHarness.instances[0]!.options.element;
    expect(element.dataset.palPin).toBeUndefined();

    // A fresh price paints the same pin cheap: the Pal hops.
    marker.perch([-0.1, 51.5], { cheap: true });
    expect(element.dataset.palPin).toBe("cheap");
    expect(element.classList.contains("isCheering")).toBe(true);

    // The same pin in the same band does nothing new.
    element.classList.remove("isCheering");
    marker.perch([-0.1, 51.5], { cheap: true });
    expect(element.classList.contains("isCheering")).toBe(false);

    // And back out of the cheap band.
    marker.perch([-0.1, 51.5], { cheap: false });
    expect(element.dataset.palPin).toBeUndefined();
    expect(element.classList.contains("isLanding")).toBe(true);
    marker.destroy();
  });

  it("walks a crawl once, standing on the line, then rests beside the last stop", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    runFrames(1);
    const [instance] = markerHarness.instances;
    const element = instance!.options.element;
    expect(element.dataset.palWalk).toBe("walking");
    expect(element.classList.contains("isWalking")).toBe(true);
    expect(instance!.options.offset).toEqual([-19, 4]);
    const early = instance!.lngLat!;
    expect(early[0]).toBeGreaterThan(crawl[0]![0]);
    expect(early[0]).toBeLessThan(crawl[1]![0]);

    // The same route again does not restart the walk.
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    expect(instance!.lngLat).toEqual(early);

    runFrames(1_000);
    expect(frames).toHaveLength(0);
    expect(element.dataset.palWalk).toBe("rested");
    expect(element.classList.contains("isWalking")).toBe(false);
    expect(instance!.lngLat).toEqual(crawl[2]);
    expect(instance!.options.offset).toEqual([14, -12]);
    expect(markerHarness.instances).toHaveLength(1);
  });

  it("carries on along the road line at the same point of the walk", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    runFrames(20);
    const road: LngLat[] = [crawl[0]!, [-0.095, 51.4995], crawl[1]!, [-0.093, 51.503], crawl[2]!];
    marker.walk({ key: crawlKey, stops: crawl, path: road, road: true });
    runFrames(1);
    const at = markerHarness.instances[0]!.lngLat!;
    // Still on the first leg, now on the road's bend south of the straight line.
    expect(at[0]).toBeLessThan(crawl[1]![0]);
    expect(at[1]).toBeLessThan(51.5);
    // A straight line never replaces the road line.
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    runFrames(1);
    expect(markerHarness.instances[0]!.lngLat![1]).toBeLessThan(51.5);
  });

  it("never walks under reduced motion, or for a sleeping Pal: it waits at the first stop", () => {
    reducedMotion(true);
    store(pal());
    createPalMapMarker(map).walk({ key: crawlKey, stops: crawl, path: crawl });
    reducedMotion(false);
    store(pal({ muted: true }));
    createPalMapMarker(map).walk({ key: crawlKey, stops: crawl, path: crawl });
    expect(frames).toHaveLength(0);
    for (const instance of markerHarness.instances) {
      expect(instance.lngLat).toEqual(crawl[0]);
      expect(instance.options.element.dataset.palWalk).toBe("waiting");
      expect(instance.options.element.classList.contains("isWalking")).toBe(false);
    }
  });

  it("ends the walk when the crawl goes and a pub is perched on instead", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    runFrames(3);
    marker.perch([-0.2, 51.4]);
    expect(frames).toHaveLength(0);
    const [instance] = markerHarness.instances;
    expect(instance!.lngLat).toEqual([-0.2, 51.4]);
    expect(instance!.options.offset).toEqual([14, -12]);
    expect(instance!.options.element.dataset.palWalk).toBeUndefined();
  });

  it("holds its place through a held frame, so a hidden tab never jumps it ahead", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    runFrames(1, 60_000);
    const plan = palWalkPlan(crawl, crawl)!;
    expect(plan.durationMs).toBeGreaterThan(100);
    expect(markerHarness.instances[0]!.options.element.dataset.palWalk).toBe("walking");
  });

  it("waits for the map to finish loading before the first step", () => {
    store(pal());
    const handlers: Array<() => void> = [];
    const loading = {
      loaded: () => false,
      once: (_event: string, handler: () => void) => handlers.push(handler),
      off: vi.fn(),
    } as unknown as maplibregl.Map;
    createPalMapMarker(loading).walk({ key: crawlKey, stops: crawl, path: crawl });
    const [instance] = markerHarness.instances;
    expect(instance!.lngLat).toEqual(crawl[0]);
    expect(instance!.options.element.dataset.palWalk).toBe("setting-off");
    expect(frames).toHaveLength(0);
    handlers.forEach((handler) => handler());
    expect(frames).toHaveLength(1);
    runFrames(2);
    expect(instance!.lngLat![0]).toBeGreaterThan(crawl[0]![0]);
  });

  it("walks back along the route to a tapped stop and jumps for joy beside it", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    runFrames(1_000);
    const [instance] = markerHarness.instances;
    const element = instance!.options.element;
    expect(element.dataset.palWalk).toBe("rested");

    // From the last stop back to the first: it walks, facing the way it goes.
    marker.visit(0);
    expect(element.dataset.palWalk).toBe("visiting");
    runFrames(5);
    expect(element.classList.contains("isWalking")).toBe(true);
    const between = instance!.lngLat!;
    expect(between).not.toEqual(crawl[2]);
    expect(between).not.toEqual(crawl[0]);
    // The second leg runs east to west, so walking it backwards faces east.
    expect(element.querySelector<HTMLElement>(".palMapMarkerBody")!.style.getPropertyValue("--pal-facing")).toBe("1");

    runFrames(200);
    expect(frames).toHaveLength(0);
    expect(element.dataset.palWalk).toBe("visited");
    expect(element.classList.contains("isCheering")).toBe(true);
    expect(element.classList.contains("isWalking")).toBe(false);
    expect(instance!.lngLat).toEqual(crawl[0]);
    expect(instance!.options.offset).toEqual([14, -12]);

    // Tapping the stop it already stands beside: just the jump again.
    marker.visit(0);
    expect(frames).toHaveLength(0);
    expect(element.classList.contains("isCheering")).toBe(true);
    // A stop that is not on the crawl does nothing.
    marker.visit(7);
    expect(element.dataset.palWalk).toBe("visited");
  });

  it("leaves the crawl walk for a stop tapped mid-walk, and does not go back to it", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    runFrames(10);
    marker.visit(2);
    runFrames(200);
    const [instance] = markerHarness.instances;
    expect(instance!.options.element.dataset.palWalk).toBe("visited");
    expect(instance!.lngLat).toEqual(crawl[2]);
    runFrames(200);
    expect(frames).toHaveLength(0);
  });

  it("steps a still Pal straight to a tapped stop", () => {
    reducedMotion(true);
    store(pal());
    const marker = createPalMapMarker(map);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    marker.visit(1);
    expect(frames).toHaveLength(0);
    const [instance] = markerHarness.instances;
    expect(instance!.lngLat).toEqual(crawl[1]);
    expect(instance!.options.element.dataset.palWalk).toBe("visited");
    expect(instance!.options.element.classList.contains("isWalking")).toBe(false);
  });

  it("takes a stop tapped while the map loads as soon as the map is ready", () => {
    store(pal());
    const handlers: Array<() => void> = [];
    const loading = {
      loaded: () => false,
      once: (_event: string, handler: () => void) => handlers.push(handler),
      off: vi.fn(),
    } as unknown as maplibregl.Map;
    const marker = createPalMapMarker(loading);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    marker.visit(1);
    expect(frames).toHaveLength(0);
    handlers.forEach((handler) => handler());
    runFrames(200);
    const [instance] = markerHarness.instances;
    expect(instance!.options.element.dataset.palWalk).toBe("visited");
    expect(instance!.lngLat).toEqual(crawl[1]);
  });

  it("celebrates a finished crawl beside the last stop, running there first", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    runFrames(5);
    const [instance] = markerHarness.instances;
    const element = instance!.options.element;
    expect(element.querySelectorAll(".palMapSparks i")).toHaveLength(8);

    announcePalMoment({ kind: "crawl-finished", stops: 3 });
    expect(element.dataset.palWalk).toBe("visiting");
    expect(element.dataset.palMoment).toBeUndefined();
    runFrames(200);
    expect(instance!.lngLat).toEqual(crawl[2]);
    expect(element.dataset.palMoment).toBe("victory");
    expect(element.classList.contains("isVictory")).toBe(true);

    // Already beside the last stop: the victory plays where it stands.
    element.classList.remove("isVictory");
    announcePalMoment({ kind: "night-finished", stops: 3 });
    expect(frames).toHaveLength(0);
    expect(element.classList.contains("isVictory")).toBe(true);
    marker.destroy();
  });

  it("walks a crew member's Pal a step behind, with no stored Pal of the reader's own", () => {
    const crewPal = pal({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Moss" });
    const first = createPalMapMarker(map, { pal: crewPal, index: 0 });
    const second = createPalMapMarker(map, { pal: crewPal, index: 1 });
    first.perch([-0.1, 51.5]);
    second.perch([-0.1, 51.5]);
    const [a, b] = markerHarness.instances;
    expect(a!.options.element.classList.contains("isCrew")).toBe(true);
    expect(a!.options.element.dataset.palCrew).toBe("0");
    expect(b!.options.element.dataset.palCrew).toBe("1");
    expect(a!.options.offset).toEqual([14 + 24, -12]);
    expect(b!.options.offset).toEqual([14 + 48, -12]);
    first.destroy();
    second.destroy();
  });

  it("never lets a crew Pal answer the reader's own Pal moments", () => {
    const crewMarker = createPalMapMarker(map, { pal: pal({ name: "Moss" }), index: 0 });
    crewMarker.perch([-0.1, 51.5]);
    announcePalMoment({ kind: "crawl-finished", stops: 2 });
    announcePalMoment({ kind: "price-added" });
    const element = markerHarness.instances[0]!.options.element;
    expect(element.classList.contains("isVictory")).toBe(false);
    expect(element.classList.contains("isCheering")).toBe(false);
    crewMarker.destroy();
  });

  it("celebrates beside a perched pub, and not at all once gone", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    // Not on the map yet: nothing to celebrate with.
    announcePalMoment({ kind: "crawl-finished", stops: 2 });
    expect(markerHarness.instances).toHaveLength(0);
    marker.perch([-0.1, 51.5]);
    announcePalMoment({ kind: "crawl-finished", stops: 2 });
    const element = markerHarness.instances[0]!.options.element;
    expect(element.classList.contains("isVictory")).toBe(true);
    marker.destroy();
    element.classList.remove("isVictory");
    announcePalMoment({ kind: "crawl-finished", stops: 2 });
    expect(element.classList.contains("isVictory")).toBe(false);
  });

  it("hops for joy where it stands for a price the reader added", () => {
    store(pal());
    const marker = createPalMapMarker(map);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    runFrames(5);
    const [instance] = markerHarness.instances;
    const element = instance!.options.element;
    const at = instance!.lngLat;
    announcePalMoment({ kind: "price-added" });
    expect(element.classList.contains("isCheering")).toBe(true);
    expect(element.classList.contains("isVictory")).toBe(false);
    // It keeps walking the crawl; the hop does not send it anywhere.
    expect(element.dataset.palWalk).toBe("walking");
    expect(instance!.lngLat).toEqual(at);
    marker.destroy();
  });
});

