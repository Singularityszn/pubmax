import { describe, expect, it } from "vitest";

import { createPinRevealCoordinator } from "@/components/map/canvas/pinRevealCoordinator";

function harness() {
  let tilesLoaded = false;
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  const renderListeners = new Set<() => void>();
  const idleListeners = new Set<() => void>();
  const visibility: boolean[] = [];
  const reveals: Array<{ reason: string; generation: number }> = [];

  const coordinator = createPinRevealCoordinator({
    timeoutMs: 3_000,
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
    setTimer: (callback) => {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
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
    fireTimeout() {
      const callback = timers.values().next().value as (() => void) | undefined;
      callback?.();
    },
  };
}

describe("pin reveal coordinator", () => {
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

  it("reveals once on timeout when tiles never settle", () => {
    const h = harness();
    h.coordinator.arm();
    h.fireTimeout();
    h.fireTimeout();

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
