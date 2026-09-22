import { afterEach, describe, expect, it, vi } from "vitest";

import { abortReason, waitForAbortableDelay } from "@/lib/abortableDelay";

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForAbortableDelay", () => {
  it("normalizes missing reasons to the platform AbortError", () => {
    expect(abortReason()).toMatchObject({
      name: "AbortError",
      message: "The operation was aborted.",
    });
  });

  it("resolves true after the delay when abort should resolve", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForAbortableDelay(50, controller.signal, {
      rejectOnAbort: false,
    });

    await vi.advanceTimersByTimeAsync(50);

    await expect(waiting).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves false with an abort when the caller owns a boolean result", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForAbortableDelay(50, controller.signal, {
      rejectOnAbort: false,
    });
    const reason = new Error("onboarding closed");

    controller.abort(reason);

    await expect(waiting).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(50);
  });

  it("rejects with the signal reason when the caller owns rejection", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForAbortableDelay(50, controller.signal, {
      rejectOnAbort: true,
    });
    const reason = new Error("auth action closed");

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(50);
  });

  it("settles immediately when the signal has already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("already closed");
    controller.abort(reason);

    await expect(
      waitForAbortableDelay(50, controller.signal, { rejectOnAbort: false }),
    ).resolves.toBe(false);
    await expect(
      waitForAbortableDelay(50, controller.signal, { rejectOnAbort: true }),
    ).rejects.toBe(reason);
  });
});
