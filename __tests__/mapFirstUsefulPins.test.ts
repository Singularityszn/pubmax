// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInitialSlimShardStart } from "@/components/map/useInitialSlimShardStart";

import {
  openingLocationCancellationAfterAttempt,
  resolveInitialSlimShardLifecycle,
  scheduleSlimShardViewportLoad,
  scheduleSlimShardRingLoads,
} from "@/lib/slimShards";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type HarnessViewport = { id: string };
type HarnessBounds = { id: string };
type LifecycleHarnessProps = {
  openingLocationResolved: boolean;
  openingLocationCancelled: boolean;
  openingLocationSettled: boolean;
  deferInitialSpatialLoad: boolean;
  initialMapView: HarnessViewport;
  openingLoadViewport: HarnessViewport;
  settledBounds: HarnessBounds | null;
  starts: Array<HarnessViewport | HarnessBounds>;
};

function LifecycleHarness({ starts, ...input }: LifecycleHarnessProps) {
  const { ready, viewport, readStart } = useInitialSlimShardStart(input);

  useEffect(() => {
    if (!ready) return;
    const start = readStart();
    starts.push(start.settledBounds ?? start.viewport);
  }, [readStart, ready, starts, viewport]);

  return null;
}

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

describe("first useful map pins", () => {
  it("starts target viewport work now and leaves later refreshes for idle time", () => {
    const targetLoad = vi.fn();
    const refreshLoad = vi.fn();
    const requestIdleCallback = vi.fn();
    const setTimeout = vi.fn();
    const timing = { requestIdleCallback, setTimeout };

    scheduleSlimShardViewportLoad(targetLoad, "target", timing);

    expect(targetLoad).toHaveBeenCalledTimes(1);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();

    scheduleSlimShardViewportLoad(refreshLoad, "refresh", timing);

    expect(refreshLoad).not.toHaveBeenCalled();
    expect(requestIdleCallback).toHaveBeenCalledWith(refreshLoad, { timeout: 3_000 });
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it("keeps the one-second fallback only for later refreshes", () => {
    const refreshLoad = vi.fn();
    const setTimeout = vi.fn();

    scheduleSlimShardViewportLoad(refreshLoad, "refresh", { setTimeout });

    expect(refreshLoad).not.toHaveBeenCalled();
    expect(setTimeout).toHaveBeenCalledWith(refreshLoad, 1_000);
  });

  it("loads the visible ring before the neighbouring ring for each settled viewport", () => {
    const reads: string[] = [];
    const idle: Array<() => void> = [];
    const timing = {
      requestIdleCallback: (callback: IdleRequestCallback) => {
        idle.push(() => callback({ didTimeout: false, timeRemaining: () => 50 }));
        return idle.length;
      },
      setTimeout: vi.fn(),
    };
    for (const viewport of ["Soho", "Camden"]) {
      scheduleSlimShardRingLoads(() => reads.push(viewport), () => reads.push(`${viewport} neighbours`), timing);
      expect(reads.at(-1)).toBe(viewport);
      idle.shift()?.();
      expect(reads.at(-1)).toBe(`${viewport} neighbours`);
    }
    expect(reads).toEqual(["Soho", "Soho neighbours", "Camden", "Camden neighbours"]);
    expect(timing.setTimeout).not.toHaveBeenCalled();
  });

  it("keeps the compatibility-core viewport stable while location resolves", () => {
    const initialMapView = { name: "initial" };
    const holdViewport = { name: "hold" };
    const resolvedViewport = { name: "resolved" };

    const beforeResolution = resolveInitialSlimShardLifecycle({
      openingLocationResolved: false,
      openingLocationCancelled: false,
      openingLocationSettled: false,
      deferInitialSpatialLoad: true,
      initialMapView,
      openingLoadViewport: holdViewport,
    });
    const afterResolution = resolveInitialSlimShardLifecycle({
      openingLocationResolved: true,
      openingLocationCancelled: false,
      openingLocationSettled: false,
      deferInitialSpatialLoad: true,
      initialMapView,
      openingLoadViewport: resolvedViewport,
    });

    expect(beforeResolution).toEqual({ ready: true, viewport: initialMapView });
    expect(afterResolution).toEqual({ ready: true, viewport: initialMapView });
    expect(afterResolution.viewport).toBe(beforeResolution.viewport);
  });

  it("waits for cancelled camera settlement and stays stable after resolution", () => {
    const initialMapView = { name: "initial" };
    const openingLoadViewport = { name: "opening" };

    const unresolved = resolveInitialSlimShardLifecycle({
      openingLocationResolved: false,
      openingLocationCancelled: false,
      openingLocationSettled: false,
      deferInitialSpatialLoad: false,
      initialMapView,
      openingLoadViewport,
    });
    const cancelledBeforeSettle = resolveInitialSlimShardLifecycle({
      openingLocationResolved: false,
      openingLocationCancelled: true,
      openingLocationSettled: false,
      deferInitialSpatialLoad: false,
      initialMapView,
      openingLoadViewport,
    });
    const cancelledAndSettled = resolveInitialSlimShardLifecycle({
      openingLocationResolved: false,
      openingLocationCancelled: true,
      openingLocationSettled: true,
      deferInitialSpatialLoad: false,
      initialMapView,
      openingLoadViewport,
    });
    const laterResolved = resolveInitialSlimShardLifecycle({
      openingLocationResolved: true,
      openingLocationCancelled: true,
      openingLocationSettled: true,
      deferInitialSpatialLoad: false,
      initialMapView,
      openingLoadViewport,
    });
    const resolvedBeforeCancelledCameraSettles =
      resolveInitialSlimShardLifecycle({
        openingLocationResolved: true,
        openingLocationCancelled: true,
        openingLocationSettled: false,
        deferInitialSpatialLoad: false,
        initialMapView,
        openingLoadViewport,
      });

    expect(unresolved).toEqual({ ready: false, viewport: openingLoadViewport });
    expect(cancelledBeforeSettle).toEqual({ ready: false, viewport: initialMapView });
    expect(resolvedBeforeCancelledCameraSettles).toEqual({
      ready: false,
      viewport: initialMapView,
    });
    expect(cancelledAndSettled).toEqual({ ready: true, viewport: initialMapView });
    expect(laterResolved).toEqual({ ready: true, viewport: initialMapView });
    expect(laterResolved.viewport).toBe(cancelledAndSettled.viewport);
  });

  it("does not turn a post-resolution camera move into cancellation", () => {
    expect(openingLocationCancellationAfterAttempt({
      openingLocationResolved: false,
      openingLocationCancelledBeforeResolution: false,
    })).toBe(true);
    expect(openingLocationCancellationAfterAttempt({
      openingLocationResolved: true,
      openingLocationCancelledBeforeResolution: false,
    })).toBe(false);
    expect(openingLocationCancellationAfterAttempt({
      openingLocationResolved: true,
      openingLocationCancelledBeforeResolution: true,
    })).toBe(true);
  });

  it("starts one returning-user loader only after cancelled camera settlement", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const starts: Array<HarnessViewport | HarnessBounds> = [];
    const initialMapView = { id: "initial" };
    const openingLoadViewport = { id: "hold" };
    const latestBounds = { id: "latest-bounds" };
    const render = async (
      overrides: Partial<LifecycleHarnessProps>,
    ) => {
      await act(async () => {
        root?.render(createElement(LifecycleHarness, {
          openingLocationResolved: false,
          openingLocationCancelled: false,
          openingLocationSettled: false,
          deferInitialSpatialLoad: false,
          initialMapView,
          openingLoadViewport,
          settledBounds: null,
          starts,
          ...overrides,
        }));
        await Promise.resolve();
      });
    };

    await render({});
    await render({ openingLocationCancelled: true });
    await render({
      openingLocationResolved: true,
      openingLocationCancelled: true,
    });
    expect(starts).toEqual([]);

    await render({
      openingLocationResolved: true,
      openingLocationCancelled: true,
      openingLocationSettled: true,
      settledBounds: latestBounds,
    });
    expect(starts).toEqual([latestBounds]);

    await render({
      openingLocationResolved: true,
      openingLocationCancelled: true,
      openingLocationSettled: true,
      openingLoadViewport: { id: "later-resolution" },
      settledBounds: { id: "later-camera-move" },
    });
    expect(starts).toEqual([latestBounds]);
  });

  it("starts one first-visit loader across hold-to-resolved transition", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const starts: Array<HarnessViewport | HarnessBounds> = [];
    const initialMapView = { id: "initial" };
    const base = {
      openingLocationCancelled: false,
      openingLocationSettled: false,
      deferInitialSpatialLoad: true,
      initialMapView,
      settledBounds: null,
      starts,
    };

    await act(async () => {
      root?.render(createElement(LifecycleHarness, {
        ...base,
        openingLocationResolved: false,
        openingLoadViewport: { id: "hold" },
      }));
      await Promise.resolve();
    });
    await act(async () => {
      root?.render(createElement(LifecycleHarness, {
        ...base,
        openingLocationResolved: true,
        openingLoadViewport: { id: "resolved" },
      }));
      await Promise.resolve();
    });

    expect(starts).toEqual([initialMapView]);
  });
});
