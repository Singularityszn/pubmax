// @vitest-environment jsdom

import { act, createElement, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Map as LibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapCamera } from "@/components/map/canvas/useMapCamera";
import { useMapArrivalTurn } from "@/components/map/canvas/useMapArrivalTurn";

import {
  ARRIVAL_BEARING_POLL_MS,
  ARRIVAL_BEARING_STILL_POLLS,
  ARRIVAL_BEARING_WAIT_CEILING_MS,
  MAP_ARRIVAL_BEARING_DEG,
  MAP_ARRIVAL_BEARING_DURATION_MS,
  MAP_ARRIVAL_BEARING_SETTLED_BY_MS,
  mapArrivalBearingPlan,
  nextArrivalBearingWait,
  type ArrivalBearingWait,
} from "@/lib/mapArrivalBearing";
import { MAP_PIN_READY_CEILING_MS } from "@/lib/mapPinRevealEvent";

const flat = {
  currentBearing: 0,
  reducedMotion: false,
  deepLinkedVenue: false,
};

describe("the map's opening turn", () => {
  it("eases a flat arrival to four degrees over one second", () => {
    expect(mapArrivalBearingPlan(flat)).toEqual({
      bearing: MAP_ARRIVAL_BEARING_DEG,
      duration: MAP_ARRIVAL_BEARING_DURATION_MS,
    });
    expect(MAP_ARRIVAL_BEARING_DEG).toBe(4);
    expect(MAP_ARRIVAL_BEARING_DURATION_MS).toBe(1_000);
  });

  it("makes no motion at all under reduced motion", () => {
    // Not a duration-0 jump: the turn carries no information, so there is
    // nothing to hand back without the motion.
    expect(mapArrivalBearingPlan({ ...flat, reducedMotion: true })).toBeNull();
  });

  it("stands aside for a deep link to a selected venue", () => {
    expect(mapArrivalBearingPlan({ ...flat, deepLinkedVenue: true })).toBeNull();
  });

  it("leaves a rotation somebody already owns", () => {
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: -8 })).toBeNull();
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: 32.5 })).toBeNull();
  });

  it("treats a hair off north as the flat arrival", () => {
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: 0.2 })).not.toBeNull();
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: -0.2 })).not.toBeNull();
  });

  it("refuses a bearing that is not a number", () => {
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: Number.NaN })).toBeNull();
  });
});

describe("the mounted opening turn through the camera owner", () => {
  let root: Root;
  let container: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let bearing: number;
  let moving: boolean;
  let pinsPending: boolean;
  let openingPending: boolean;
  let reduced: { current: boolean };
  let gesture: { current: { active: boolean; endedAt: number | null } };
  let mapRef: { current: LibreMap | null };
  const easeTo = vi.fn();
  const stop = vi.fn();

  function Turn({ ready = true, error = false, selected = false }: {
    ready?: boolean; error?: boolean; selected?: boolean;
  }) {
    const camera = useMapCamera({
      mapRef,
      reducedRef: reduced,
      gestureCameraRef: gesture,
      cityViewRef: { current: { center: [-0.13, 51.51], zoom: 12, pitch: 40, bearing: 0 } },
      cityBoundsRef: { current: [[-0.3, 51.4], [0.1, 51.7]] },
      routeRef: { current: [] },
      routeLineRef: { current: { type: "FeatureCollection", features: [] } },
      venuesRef: { current: [] },
    });
    const sample = useCallback(() => ({
      moving: moving || camera.cameraLanePending(), pinsPending, openingPending,
    }), [camera]);
    useMapArrivalTurn({ mapRef, mapInstanceReady: ready, mapError: error,
      deepLinked: selected, sample, easeArrivalBearing: camera.easeArrivalBearing });
    return null;
  }

  const render = (props: Parameters<typeof Turn>[0] = {}) => act(() => root.render(createElement(Turn, props)));
  const advance = (milliseconds: number) => act(() => { vi.advanceTimersByTime(milliseconds); });
  const paint = () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(performance.now());
  });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    frames = new Map();
    nextFrame = 0;
    bearing = 0;
    moving = false;
    pinsPending = false;
    openingPending = false;
    reduced = { current: false };
    gesture = { current: { active: false, endedAt: null } };
    mapRef = { current: { getBearing: () => bearing, stop, easeTo } as unknown as LibreMap };
    easeTo.mockReset().mockImplementation((options: { bearing: number }) => { bearing = options.bearing; });
    stop.mockReset();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for pins, then makes one four-degree, one-second turn per mount despite a context rebuild", () => {
    pinsPending = true;
    render();
    advance(12_000);
    paint();
    expect(easeTo).not.toHaveBeenCalled();
    pinsPending = false;
    advance(100);
    paint();
    expect(easeTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ bearing: 4, duration: 1_000 }));
    expect(stop).toHaveBeenCalledOnce();
    render({ ready: false });
    bearing = 0;
    render({ ready: true });
    advance(20_000);
    paint();
    expect(easeTo).toHaveBeenCalledOnce();
  });

  it("waits for an opening move and releases an unsettled camera within six seconds", () => {
    moving = true;
    openingPending = true;
    render();
    advance(5_900);
    paint();
    expect(easeTo).not.toHaveBeenCalled();
    advance(100);
    paint();
    expect(easeTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ bearing: 4, duration: 1_000 }));
    expect(MAP_ARRIVAL_BEARING_SETTLED_BY_MS).toBeLessThanOrEqual(20_000);
  });

  it.each(["reduced", "deep-link", "rotated", "gesture"])("preserves the %s camera", (owner) => {
    reduced.current = owner === "reduced";
    gesture.current.active = owner === "gesture";
    if (owner === "rotated") bearing = -8;
    render({ selected: owner === "deep-link" });
    advance(20_000);
    paint();
    expect(easeTo).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("reads selection only on arrival and refuses a gesture begun before the queued camera frame", () => {
    pinsPending = true;
    render();
    render({ selected: true });
    pinsPending = false;
    advance(100);
    gesture.current.active = true;
    paint();
    expect(stop).not.toHaveBeenCalled();
    expect(easeTo).not.toHaveBeenCalled();
    gesture.current.active = false;
    render({ ready: false });
    render({ ready: true });
    advance(20_000);
    paint();
    expect(easeTo).not.toHaveBeenCalled();
  });

  it("keeps the arrival deep link after that selection disappears", () => {
    pinsPending = true;
    render({ selected: true });
    render({ selected: false });
    pinsPending = false;
    advance(20_000);
    paint();
    expect(easeTo).not.toHaveBeenCalled();
  });

  it("spends a failed map's turn and cancels an unmounted map's pending turn", () => {
    render({ error: true });
    render({ error: false });
    advance(20_000);
    paint();
    expect(easeTo).not.toHaveBeenCalled();
    act(() => root.render(null));
    pinsPending = true;
    render();
    advance(100);
    act(() => root.render(null));
    pinsPending = false;
    advance(20_000);
    paint();
    expect(easeTo).not.toHaveBeenCalled();
  });
});

function pollsUntilTurn(samples: (poll: number) => { moving: boolean; openingPending: boolean }): number {
  let wait: ArrivalBearingWait | null = { stillPolls: 0, waitedMs: 0 };
  let polls = 0;
  while (wait) {
    polls += 1;
    wait = nextArrivalBearingWait(wait, samples(polls));
  }
  return polls;
}

describe("the opening turn waits for the camera's other writers", () => {
  const ceilingPolls = ARRIVAL_BEARING_WAIT_CEILING_MS / ARRIVAL_BEARING_POLL_MS;

  it("holds the opening camera until the first pin frame, even past the camera wait ceiling", () => {
    let wait: ArrivalBearingWait | null = { stillPolls: 0, waitedMs: 0 };
    for (let poll = 0; poll <= ceilingPolls; poll += 1) {
      wait = nextArrivalBearingWait(wait!, {
        moving: false, openingPending: false, pinsPending: true,
      });
      expect(wait).not.toBeNull();
    }
    expect(nextArrivalBearingWait(wait!, {
      moving: false, openingPending: false, pinsPending: false,
    })).toBeNull();
  });

  it("keeps a gesture before the first pin frame in the existing camera wait", () => {
    const held = nextArrivalBearingWait({ stillPolls: 0, waitedMs: 0 }, {
      moving: true, openingPending: false, pinsPending: true,
    });
    const revealed = nextArrivalBearingWait(held!, {
      moving: true, openingPending: false, pinsPending: false,
    });
    expect(revealed).not.toBeNull();
    expect(nextArrivalBearingWait(revealed!, {
      moving: false, openingPending: false, pinsPending: false,
    })).toBeNull();
  });

  it("releases the pin wait when its existing fallback reports, without a second camera ceiling", () => {
    const held = nextArrivalBearingWait({ stillPolls: 0, waitedMs: MAP_PIN_READY_CEILING_MS }, {
      moving: false, openingPending: true, pinsPending: true,
    });
    expect(held).not.toBeNull();
    expect(nextArrivalBearingWait(held!, {
      moving: false, openingPending: true, pinsPending: false,
    })).toBeNull();
  });

  it("turns on the first still poll of a settled camera", () => {
    expect(pollsUntilTurn(() => ({ moving: false, openingPending: false }))).toBe(
      ARRIVAL_BEARING_STILL_POLLS,
    );
  });

  it("does not count a camera whose opening answer is still to land as still", () => {
    // The opening-location fly landed during the turn and stopped it at 1.3
    // degrees. A still camera with that fly pending is waiting, not resting.
    expect(
      pollsUntilTurn((poll) => ({ moving: false, openingPending: poll <= 10 })),
    ).toBe(10 + ARRIVAL_BEARING_STILL_POLLS);
  });

  it("waits out the answer's own move before it turns", () => {
    expect(
      pollsUntilTurn((poll) => ({ moving: poll > 3 && poll <= 12, openingPending: poll <= 3 })),
    ).toBe(12 + ARRIVAL_BEARING_STILL_POLLS);
  });

  it("still turns at the ceiling when the camera never settles", () => {
    expect(pollsUntilTurn(() => ({ moving: false, openingPending: true }))).toBe(ceilingPolls);
    expect(pollsUntilTurn(() => ({ moving: true, openingPending: false }))).toBe(ceilingPolls);
  });
});
