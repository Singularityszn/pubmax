import { describe, expect, it } from "vitest";

import { createCameraIntentCoordinator } from "@/lib/cameraIntent";

describe("camera intent coordinator", () => {
  it("coalesces competing intents so only the newest camera move runs", () => {
    const frames = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    const calls: string[] = [];
    let nextFrame = 1;
    const coordinator = createCameraIntentCoordinator({
      requestFrame: (callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
      cancelFrame: (id) => {
        cancelled.push(id);
        frames.delete(id);
      },
      now: () => 100,
    });

    coordinator.schedule("route", "route:a>b>c", () => calls.push("route"));
    coordinator.schedule("venue", "venue:d", () => calls.push("venue"));

    expect(cancelled).toEqual([1]);
    expect(frames.size).toBe(1);
    frames.get(2)?.(100);
    expect(calls).toEqual(["venue"]);
  });

  it("does not restart an equivalent settled animation inside the dedupe window", () => {
    let now = 100;
    let callback: FrameRequestCallback | null = null;
    const calls: string[] = [];
    const coordinator = createCameraIntentCoordinator({
      requestFrame: (next) => {
        callback = next;
        return 1;
      },
      cancelFrame: () => undefined,
      now: () => now,
      dedupeMs: 800,
    });

    coordinator.schedule("nearby", "nearby:51.50,-0.12", () => calls.push("first"));
    (callback as FrameRequestCallback | null)?.(now);
    coordinator.schedule("nearby", "nearby:51.50,-0.12", () => calls.push("duplicate"));
    expect(calls).toEqual(["first"]);

    now = 901;
    coordinator.schedule("nearby", "nearby:51.50,-0.12", () => calls.push("later"));
    (callback as FrameRequestCallback | null)?.(now);
    expect(calls).toEqual(["first", "later"]);
  });

  it("does not keep cancelling and rescheduling an equivalent pending intent", () => {
    let callback: FrameRequestCallback | null = null;
    const cancelled: number[] = [];
    const calls: string[] = [];
    const coordinator = createCameraIntentCoordinator({
      requestFrame: (next) => {
        callback = next;
        return 7;
      },
      cancelFrame: (id) => cancelled.push(id),
      now: () => 100,
    });

    expect(coordinator.schedule("route", "route:a>b>c", () => calls.push("first"))).toBe(true);
    expect(coordinator.schedule("route", "route:a>b>c", () => calls.push("duplicate"))).toBe(false);
    expect(cancelled).toEqual([]);
    (callback as FrameRequestCallback | null)?.(100);
    expect(calls).toEqual(["first"]);
  });
});
