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

  it("holds a line said over a map still loading, and says it as the walk sets off", () => {
    store(pal());
    const handlers: Array<() => void> = [];
    const loading = {
      loaded: () => false,
      once: (_event: string, handler: () => void) => handlers.push(handler),
      off: vi.fn(),
    } as unknown as maplibregl.Map;
    const marker = createPalMapMarker(loading);
    marker.walk({ key: crawlKey, stops: crawl, path: crawl });
    marker.say("Fastest way. Keep up.");
    const bubble = markerHarness.instances[0]!.options.element.querySelector<HTMLElement>(".palMapMarkerSay")!;
    expect(bubble.hidden).toBe(true);
    handlers.forEach((handler) => handler());
    expect(bubble.hidden).toBe(false);
    expect(bubble.textContent).toBe("Fastest way. Keep up.");
  });

  it("says nothing while asleep (muted), and a crew Pal says nothing", () => {
    store(pal({ muted: true }));
    const sleeping = createPalMapMarker(map);
    sleeping.perch([-0.1, 51.5]);
    sleeping.say("7 min to the next pub. Race you.");
    const crew = createPalMapMarker(map, { pal: pal({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002" }), index: 0 });
    crew.perch([-0.1, 51.5]);
    crew.say("7 min to the next pub. Race you.");
    for (const instance of markerHarness.instances) {
      expect(instance.options.element.querySelector<HTMLElement>(".palMapMarkerSay")!.hidden).toBe(true);
    }
    expect(markerHarness.instances).toHaveLength(2);
  });

  describe("tonight's next stop", () => {
    function nextStop(stop: number, name: string) {
      const open = vi.fn();
      return { target: { stop, name, open }, open };
    }
    const tappable = (element: HTMLElement) => ({
      role: element.getAttribute("role"),
      label: element.getAttribute("aria-label"),
      hidden: element.getAttribute("aria-hidden"),
      chip: element.querySelector<HTMLElement>(".palMapMarkerNext")!.hidden
        ? null
        : element.querySelector(".palMapMarkerNext")!.textContent,
    });
    const decorative = { role: null, label: null, hidden: "true", chip: null };

    it("walks only as far as the next stop, and waits there as a button that opens it", () => {
      store(pal());
      const marker = createPalMapMarker(map);
      const lamb = nextStop(1, "The Lamb");
      marker.walk({ key: crawlKey, stops: crawl, path: crawl });
      marker.nextStop(lamb.target);
      runFrames(1);
      const [instance] = markerHarness.instances;
      const element = instance!.options.element;
      // Walking, it is decorative and takes no taps.
      expect(tappable(element)).toEqual(decorative);
      element.click();
      expect(lamb.open).not.toHaveBeenCalled();

      runFrames(1_000);
      expect(frames).toHaveLength(0);
      expect(element.dataset.palWalk).toBe("rested");
      expect(instance!.lngLat).toEqual(crawl[1]);
      expect(instance!.options.offset).toEqual([14, -12]);
      expect(tappable(element)).toEqual({ role: "button", label: "Next stop: The Lamb", hidden: null, chip: "Next: The Lamb" });
      expect(element.classList.contains("isNextStop")).toBe(true);
      expect(element.tabIndex).toBe(0);

      element.click();
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      expect(lamb.open).toHaveBeenCalledTimes(2);
    });

    it("walks on to a new next stop, decorative on the way, and opens the new one", () => {
      store(pal());
      const marker = createPalMapMarker(map);
      const lamb = nextStop(1, "The Lamb");
      marker.walk({ key: crawlKey, stops: crawl, path: crawl });
      marker.nextStop(lamb.target);
      runFrames(1_000);
      const element = markerHarness.instances[0]!.options.element;

      const crown = nextStop(2, "The Crown");
      marker.nextStop(crown.target);
      expect(element.dataset.palWalk).toBe("visiting");
      expect(tappable(element)).toEqual(decorative);
      runFrames(200);
      expect(markerHarness.instances[0]!.lngLat).toEqual(crawl[2]);
      expect(tappable(element)).toEqual({ role: "button", label: "Next stop: The Crown", hidden: null, chip: "Next: The Crown" });
      element.click();
      expect(crown.open).toHaveBeenCalledTimes(1);
      expect(lamb.open).not.toHaveBeenCalled();
    });

    it("turns for a newer next stop while still on its way to the old one, but not on a trip the reader asked for", () => {
      store(pal());
      const marker = createPalMapMarker(map);
      const four: LngLat[] = [...crawl, [-0.1, 51.51]];
      marker.walk({ key: four.map((stop) => stop.join(",")).join(";"), stops: four, path: four });
      marker.nextStop(nextStop(1, "The Lamb").target);
      runFrames(1_000);
      const [instance] = markerHarness.instances;
      const element = instance!.options.element;
      expect(instance!.lngLat).toEqual(four[1]);

      // On its way to the Crown, the night moves on to the Bell.
      marker.nextStop(nextStop(2, "The Crown").target);
      runFrames(3);
      expect(element.dataset.palWalk).toBe("visiting");
      const bell = nextStop(3, "The Bell");
      marker.nextStop(bell.target);
      runFrames(400);
      expect(frames).toHaveLength(0);
      expect(instance!.lngLat).toEqual(four[3]);
      expect(tappable(element)).toEqual({ role: "button", label: "Next stop: The Bell", hidden: null, chip: "Next: The Bell" });
      element.click();
      expect(bell.open).toHaveBeenCalledTimes(1);

      // Sent back to the first stop by the reader, it keeps going there.
      marker.visit(0);
      runFrames(3);
      marker.nextStop(nextStop(2, "The Crown").target);
      runFrames(400);
      expect(instance!.lngLat).toEqual(four[0]);
      expect(tappable(element)).toEqual(decorative);
    });

    it("takes no taps beside any other stop, or once the plan has no next stop", () => {
      store(pal());
      const marker = createPalMapMarker(map);
      const lamb = nextStop(1, "The Lamb");
      marker.walk({ key: crawlKey, stops: crawl, path: crawl });
      marker.nextStop(lamb.target);
      runFrames(1_000);
      const element = markerHarness.instances[0]!.options.element;

      // Sent to another stop the reader tapped: decorative there.
      marker.visit(0);
      runFrames(200);
      expect(element.dataset.palWalk).toBe("visited");
      expect(tappable(element)).toEqual(decorative);
      element.click();
      expect(lamb.open).not.toHaveBeenCalled();

      // Back at the next stop it is the button again; with no next stop it is not.
      marker.visit(1);
      runFrames(200);
      expect(tappable(element).role).toBe("button");
      marker.nextStop(null);
      expect(tappable(element)).toEqual(decorative);
      expect(element.classList.contains("isNextStop")).toBe(false);
      element.click();
      expect(lamb.open).not.toHaveBeenCalled();

      // A perched pub (no plan route) is never a button.
      marker.nextStop(lamb.target);
      marker.perch([-0.1, 51.5]);
      expect(tappable(element)).toEqual(decorative);
    });

    it("waits at the next stop, not the first, for a still Pal", () => {
      reducedMotion(true);
      store(pal());
      const marker = createPalMapMarker(map);
      const lamb = nextStop(1, "The Lamb");
      marker.nextStop(lamb.target);
      marker.walk({ key: crawlKey, stops: crawl, path: crawl });
      expect(frames).toHaveLength(0);
      const [instance] = markerHarness.instances;
      expect(instance!.lngLat).toEqual(crawl[1]);
      expect(instance!.options.element.dataset.palWalk).toBe("waiting");
      expect(tappable(instance!.options.element).label).toBe("Next stop: The Lamb");
    });

    it("leads a chosen way: says its line, walks the path, and arrives with a jump for joy as the next-stop button", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        store(pal());
        const marker = createPalMapMarker(map);
        // A way that bends round a corner from this stop to the next.
        const path: LngLat[] = [crawl[0]!, [-0.1, 51.502], crawl[1]!];
        marker.walk({ key: "lead:a>b:walk", stops: [crawl[0]!, crawl[1]!], path, road: true, cheer: true });
        const lamb = nextStop(1, "The Lamb");
        marker.nextStop(lamb.target);
        marker.say("Free and cheapest. Legs it is.");
        runFrames(1);
        const [instance] = markerHarness.instances;
        const element = instance!.options.element;
        const bubble = element.querySelector<HTMLElement>(".palMapMarkerSay")!;
        expect(bubble.hidden).toBe(false);
        expect(bubble.textContent).toBe("Free and cheapest. Legs it is.");
        expect(element.classList.contains("isSaying")).toBe(true);
        expect(tappable(element)).toEqual(decorative);

        // On its way it walks the corner's run, not the straight line.
        runFrames(3);
        expect(element.classList.contains("isWalking")).toBe(true);
        expect(instance!.lngLat![0]).toBeCloseTo(-0.1, 9);

        runFrames(1_000);
        expect(instance!.lngLat).toEqual(crawl[1]);
        expect(element.classList.contains("isCheering")).toBe(true);
        expect(element.classList.contains("isLanding")).toBe(false);
        // Waiting as the button, the chip takes the space and the line is done.
        expect(tappable(element)).toEqual({ role: "button", label: "Next stop: The Lamb", hidden: null, chip: "Next: The Lamb" });
        expect(bubble.hidden).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("says a line for a few seconds, and a new line or null replaces it", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        store(pal());
        const marker = createPalMapMarker(map);
        marker.perch([-0.1, 51.5]);
        const bubble = markerHarness.instances[0]!.options.element.querySelector<HTMLElement>(".palMapMarkerSay")!;
        marker.say("Fastest way. Keep up.");
        vi.advanceTimersByTime(4_000);
        expect(bubble.textContent).toBe("Fastest way. Keep up.");
        marker.say("This way. Follow me.");
        vi.advanceTimersByTime(4_000);
        expect(bubble.textContent).toBe("This way. Follow me.");
        vi.advanceTimersByTime(1_000);
        expect(bubble.hidden).toBe(true);
        marker.say("TfL won't say the fare. Bold choice.");
        marker.say(null);
        expect(bubble.hidden).toBe(true);
        expect(bubble.textContent).toBe("");
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits a crew Pal at the next stop too, as a picture, never a button", () => {
      const marker = createPalMapMarker(map, { pal: pal({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002" }), index: 0 });
      const lamb = nextStop(1, "The Lamb");
      marker.walk({ key: crawlKey, stops: crawl, path: crawl });
      marker.nextStop(lamb.target);
      runFrames(1_000);
      const [instance] = markerHarness.instances;
      expect(instance!.lngLat).toEqual(crawl[1]);
      const element = instance!.options.element;
      expect(tappable(element)).toEqual(decorative);
      element.click();
      expect(lamb.open).not.toHaveBeenCalled();
    });
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

