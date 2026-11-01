import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { visibleInterval } from "@/lib/visiblePolling";

// A hidden map tab used to ask the database for new Pint Drops every 30
// seconds, for a page nobody could see. `visibleInterval` holds a poll while
// the page is hidden and asks once when it comes back.

type FakeDocument = EventTarget & { visibilityState: "visible" | "hidden" };

let fakeDocument: FakeDocument;

function setVisibility(state: "visible" | "hidden") {
  fakeDocument.visibilityState = state;
  fakeDocument.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeDocument = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
  vi.stubGlobal("document", fakeDocument);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("visibleInterval", () => {
  it("does not run at start, then runs on every interval while visible", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 30_000);

    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it("holds every tick while hidden and runs once when the page returns", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 30_000);

    setVisibility("hidden");
    vi.advanceTimersByTime(5 * 60_000);
    expect(tick).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not run on return when no tick fell due while hidden", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 30_000);

    setVisibility("hidden");
    vi.advanceTimersByTime(10_000);
    setVisibility("visible");
    expect(tick).not.toHaveBeenCalled();
    stop();
  });

  it("stops the timer and the listener when stopped", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 30_000);

    setVisibility("hidden");
    vi.advanceTimersByTime(30_000);
    stop();
    setVisibility("visible");
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it("falls back to a plain interval where there is no document", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("document", undefined);
    const tick = vi.fn();
    const stop = visibleInterval(tick, 30_000);

    vi.advanceTimersByTime(30_000);
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(30_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
