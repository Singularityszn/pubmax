import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BACKGROUND_WARMUP_HOLD_CEILING_MS,
  backgroundWarmupHoldCount,
  holdBackgroundWarmup,
  resetBackgroundWarmupForTests,
  whenBackgroundWarmupAllowed,
} from "@/lib/backgroundWarmup";

// A fake clock standing in for the browser's timers + idle queue, so the gate's
// ordering is asserted rather than waited on.
function fakeTimers() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; run: () => void; idle: boolean }>();
  return {
    api: {
      setTimeout: (run: () => void, ms: number) => {
        const handle = nextHandle++;
        pending.set(handle, { at: now + ms, run, idle: false });
        return handle;
      },
      clearTimeout: (handle: number) => {
        pending.delete(handle);
      },
      requestIdle: (run: () => void, timeoutMs: number) => {
        const handle = nextHandle++;
        pending.set(handle, { at: now + timeoutMs, run, idle: true });
        return handle;
      },
      cancelIdle: (handle: number) => {
        pending.delete(handle);
      },
    },
    /** Fire the idle queue without advancing the clock. */
    runIdle() {
      for (const [handle, entry] of [...pending]) {
        if (!entry.idle) continue;
        pending.delete(handle);
        entry.run();
      }
    },
    advance(ms: number) {
      now += ms;
      for (const [handle, entry] of [...pending]) {
        if (entry.at > now) continue;
        pending.delete(handle);
        entry.run();
      }
    },
  };
}

afterEach(() => {
  resetBackgroundWarmupForTests();
});

describe("background warmup gate", () => {
  it("runs at idle when no surface is holding", () => {
    const timers = fakeTimers();
    const run = vi.fn();
    whenBackgroundWarmupAllowed(run, 5_000, timers.api);
    expect(run).not.toHaveBeenCalled();
    timers.runIdle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run while a surface holds, and idle alone cannot release it", () => {
    const timers = fakeTimers();
    const run = vi.fn();
    holdBackgroundWarmup(BACKGROUND_WARMUP_HOLD_CEILING_MS, timers.api);
    whenBackgroundWarmupAllowed(run, 5_000, timers.api);
    timers.runIdle();
    expect(run).not.toHaveBeenCalled();
  });

  it("runs after the last hold releases, and still waits for idle", () => {
    const timers = fakeTimers();
    const run = vi.fn();
    const releaseA = holdBackgroundWarmup(BACKGROUND_WARMUP_HOLD_CEILING_MS, timers.api);
    const releaseB = holdBackgroundWarmup(BACKGROUND_WARMUP_HOLD_CEILING_MS, timers.api);
    whenBackgroundWarmupAllowed(run, 5_000, timers.api);

    releaseA();
    expect(backgroundWarmupHoldCount()).toBe(1);
    timers.runIdle();
    expect(run).not.toHaveBeenCalled();

    releaseB();
    // Released, but the work is queued behind idle rather than run inline.
    expect(run).not.toHaveBeenCalled();
    timers.runIdle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("releases on its own ceiling so a surface that never paints cannot starve warmup", () => {
    const timers = fakeTimers();
    const run = vi.fn();
    holdBackgroundWarmup(BACKGROUND_WARMUP_HOLD_CEILING_MS, timers.api);
    whenBackgroundWarmupAllowed(run, 5_000, timers.api);

    timers.advance(BACKGROUND_WARMUP_HOLD_CEILING_MS);
    expect(backgroundWarmupHoldCount()).toBe(0);
    timers.runIdle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("counts a release once, however many times it is called", () => {
    const timers = fakeTimers();
    const release = holdBackgroundWarmup(BACKGROUND_WARMUP_HOLD_CEILING_MS, timers.api);
    holdBackgroundWarmup(BACKGROUND_WARMUP_HOLD_CEILING_MS, timers.api);
    release();
    release();
    release();
    expect(backgroundWarmupHoldCount()).toBe(1);
  });

  it("a cancelled waiter never runs, before or after the hold clears", () => {
    const timers = fakeTimers();
    const run = vi.fn();
    const release = holdBackgroundWarmup(BACKGROUND_WARMUP_HOLD_CEILING_MS, timers.api);
    const cancel = whenBackgroundWarmupAllowed(run, 5_000, timers.api);
    cancel();
    release();
    timers.runIdle();
    expect(run).not.toHaveBeenCalled();
  });
});
