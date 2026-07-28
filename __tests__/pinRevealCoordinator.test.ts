import { describe, expect, it } from "vitest";

import {
  basemapRetryForReveal,
  createPinRevealCoordinator,
} from "@/components/map/canvas/pinRevealCoordinator";

function harness() {
  let tilesLoaded = false;
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  const timerDelays = new Map<number, number>();
  const renderListeners = new Set<() => void>();
  const idleListeners = new Set<() => void>();
  const visibility: boolean[] = [];
  const reveals: Array<{ reason: string; generation: number }> = [];

  const coordinator = createPinRevealCoordinator({
    pinRevealTimeoutMs: 3_000,
    readyCeilingMs: 12_000,
    areTilesLoaded: () => tilesLoaded,
    setPinsVisible: (visible) => visibility.push(visible),
    subscribeRender: (listener) => {
      renderListeners.add(listener);
      return () => renderListeners.delete(listener);
    },
    subscribeIdle: (listener) => {
      idleListeners.add(listener);
      return () => idleListeners.delete(listener);
    },
    requestFrame: (callback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
    setTimer: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, callback);
      timerDelays.set(id, delayMs);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
      timerDelays.delete(id);
    },
    onReveal: (reason, generation) => reveals.push({ reason, generation }),
  });

  return {
    coordinator,
    visibility,
    reveals,
    renderListeners,
    idleListeners,
    frames,
    timers,
    setTilesLoaded(value: boolean) { tilesLoaded = value; },
    fireRender() { [...renderListeners].forEach((listener) => listener()); },
    fireIdle() { [...idleListeners].forEach((listener) => listener()); },
    flushFrame() {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) return;
      frames.delete(entry[0]);
      entry[1](0);
    },
    fireByDelay(delayMs: number) {
      for (const [id, delay] of timerDelays) {
        if (delay === delayMs) {
          const callback = timers.get(id);
          callback?.();
          return;
        }
      }
    },
    firePinTimeout() { this.fireByDelay(3_000); },
    fireCeiling() { this.fireByDelay(12_000); },
  };
}

describe("pin reveal coordinator", () => {
  it("turns only a basemap timeout into an honest retry notice", () => {
    expect(basemapRetryForReveal("tiles")).toBeNull();
    expect(basemapRetryForReveal("idle")).toBeNull();
    expect(basemapRetryForReveal("timeout")).toEqual({
      kind: "tiles",
      message: "Map background couldn't load. Tap Retry to try again.",
    });
  });

  it("keeps pins gated until basemap tiles have painted", () => {
    const h = harness();
    h.coordinator.arm();

    h.fireRender();
    h.fireIdle();
    expect(h.visibility).toEqual([false]);
    expect(h.frames.size).toBe(0);

    h.setTilesLoaded(true);
    h.fireRender();
    expect(h.visibility).toEqual([false]);
    h.flushFrame();

    expect(h.visibility).toEqual([false, true]);
    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
    expect(h.renderListeners.size).toBe(0);
    expect(h.idleListeners.size).toBe(0);
    expect(h.timers.size).toBe(0);
  });

  it("un-gates pins on the short fallback without lifting the parent chrome", () => {
    const h = harness();
    h.coordinator.arm();
    // Slow tile stream: the short pin fallback fires first.
    h.firePinTimeout();

    // Pins un-gate so they can't hang hidden...
    expect(h.visibility).toEqual([false, true]);
    // ...but the parent chrome stays up (no reveal) until a real frame or ceiling.
    expect(h.reveals).toEqual([]);
    expect(h.renderListeners.size).toBe(1);
    expect(h.idleListeners.size).toBe(1);
  });

  it("reveals from a real frame after the pin fallback, without the ceiling", () => {
    const h = harness();
    h.coordinator.arm();
    h.firePinTimeout();
    expect(h.reveals).toEqual([]);

    // The basemap finally paints: the real frame lifts the chrome, not the ceiling.
    h.setTilesLoaded(true);
    h.fireRender();
    h.flushFrame();

    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
    // Pins were already shown by the fallback, so no duplicate visibility write.
    expect(h.visibility).toEqual([false, true]);
    expect(h.timers.size).toBe(0);
  });

  it("lifts the chrome at the honest ceiling only when tiles never settle", () => {
    const h = harness();
    h.coordinator.arm();
    h.firePinTimeout();
    h.fireCeiling();
    h.fireCeiling();

    expect(h.visibility).toEqual([false, true]);
    expect(h.reveals).toEqual([{ reason: "timeout", generation: 1 }]);
  });

  it("cancels obsolete style generations and ignores stale callbacks", () => {
    const h = harness();
    h.coordinator.arm();
    const staleRender = [...h.renderListeners][0];
    const firstTimer = [...h.timers.values()][0];

    h.coordinator.arm();
    h.setTilesLoaded(true);
    staleRender?.();
    firstTimer?.();
    expect(h.reveals).toEqual([]);

    h.fireRender();
    h.flushFrame();
    expect(h.visibility).toEqual([false, false, true]);
    expect(h.reveals).toEqual([{ reason: "tiles", generation: 2 }]);
  });

  it("prevents post-unmount frame and timer writes", () => {
    const h = harness();
    h.setTilesLoaded(true);
    h.coordinator.arm();
    h.fireRender();
    const staleFrame = [...h.frames.values()][0];
    const staleTimer = [...h.timers.values()][0];

    h.coordinator.dispose();
    staleFrame?.(0);
    staleTimer?.();

    expect(h.visibility).toEqual([false]);
    expect(h.reveals).toEqual([]);
    expect(h.renderListeners.size).toBe(0);
    expect(h.idleListeners.size).toBe(0);
  });

  it("does not trust the pre-render tile-ready value after a style load", () => {
    const h = harness();
    h.setTilesLoaded(true);
    h.coordinator.arm();

    expect(h.frames.size).toBe(0);
    expect(h.reveals).toEqual([]);

    h.fireRender();
    h.flushFrame();
    expect(h.reveals).toEqual([{ reason: "tiles", generation: 1 }]);
  });

  it("reveals from idle only after tile readiness and still does so once", () => {
    const h = harness();
    h.coordinator.arm();
    h.setTilesLoaded(true);
    h.fireIdle();
    h.flushFrame();
    h.fireRender();

    expect(h.reveals).toEqual([{ reason: "idle", generation: 1 }]);
    expect(h.visibility).toEqual([false, true]);
  });
});
