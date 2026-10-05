// GAP 18 (mobile store-readiness audit, 2026-09-04, 390x844): `/map?log=1` is
// the working entry to the core loop, and the venue sheet opened with the Pint
// Drop composer's price step starting at y=696 in an 844px viewport and running
// 237px tall, so the price field sat on the bottom edge and "Log it" was off
// screen behind the sheet's own action bar. The reader had said the one thing
// they came to say and then had to scroll to act on it.
//
// The fix is a REVEAL and never a re-layout, and this is its contract.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LOG_INTENT_PRICE_STEP_SELECTOR,
  cancelLogIntentReveal,
  logIntentRevealBehavior,
  requestLogIntentReveal,
  takeLogIntentReveal,
} from "@/lib/logIntentReveal";

function stepWith(scrollIntoView: unknown): HTMLElement {
  return { scrollIntoView } as unknown as HTMLElement;
}

function rootWith(step: HTMLElement | null) {
  return {
    querySelector: (selector: string) =>
      selector === LOG_INTENT_PRICE_STEP_SELECTOR ? (step as Element | null) : null,
  };
}

/** A frame queue the test runs by hand, so "next frame" is a step it controls. */
function frames() {
  const queue: Array<() => void> = [];
  return {
    nextFrame: (callback: () => void) => {
      queue.push(callback);
    },
    flush: () => {
      while (queue.length > 0) queue.shift()?.();
    },
  };
}

afterEach(() => {
  cancelLogIntentReveal();
});

describe("reduced motion changes the glide, never the move", () => {
  it("jumps rather than glides when the reader asked for less motion", () => {
    expect(logIntentRevealBehavior(true)).toBe("auto");
    expect(logIntentRevealBehavior(false)).toBe("smooth");
  });
});

describe("waiting for the composer", () => {
  it("reveals the price step when it mounts, however late that is", () => {
    // The old reveal polled against a 1.5s clock and gave up when the
    // composer mounted later, which a loaded machine did one arrival in four.
    // Nothing here is timed: the request waits for the step itself.
    const clock = frames();
    requestLogIntentReveal(rootWith(null), false, clock.nextFrame);
    clock.flush();

    const scrollIntoView = vi.fn();
    expect(takeLogIntentReveal(stepWith(scrollIntoView))).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("jumps on mount when the reader asked for less motion", () => {
    requestLogIntentReveal(rootWith(null), true, () => {});
    const scrollIntoView = vi.fn();
    takeLogIntentReveal(stepWith(scrollIntoView));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("reveals once, so a later composer mount does not scroll the sheet again", () => {
    requestLogIntentReveal(rootWith(null), false, () => {});
    const first = vi.fn();
    const second = vi.fn();
    expect(takeLogIntentReveal(stepWith(first))).toBe(true);
    expect(takeLogIntentReveal(stepWith(second))).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("does nothing when no log intent asked for it", () => {
    const scrollIntoView = vi.fn();
    expect(takeLogIntentReveal(stepWith(scrollIntoView))).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps waiting rather than throwing where scrollIntoView is absent", () => {
    requestLogIntentReveal(rootWith(null), false, () => {});
    expect(takeLogIntentReveal(stepWith(undefined))).toBe(false);
    const scrollIntoView = vi.fn();
    expect(takeLogIntentReveal(stepWith(scrollIntoView))).toBe(true);
  });

  it("stops when the reader closes the sheet, so no late scroll lands", () => {
    requestLogIntentReveal(rootWith(null), false, () => {});
    cancelLogIntentReveal();
    const scrollIntoView = vi.fn();
    expect(takeLogIntentReveal(stepWith(scrollIntoView))).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("a composer that is already open", () => {
  it("reveals its mounted step on the next frame, after the sheet commits", () => {
    const scrollIntoView = vi.fn();
    const clock = frames();
    requestLogIntentReveal(rootWith(stepWith(scrollIntoView)), false, clock.nextFrame);
    expect(scrollIntoView).not.toHaveBeenCalled();
    clock.flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("leaves the frame nothing to do when a mount took the request first", () => {
    const fromFrame = vi.fn();
    const fromMount = vi.fn();
    const clock = frames();
    requestLogIntentReveal(rootWith(stepWith(fromFrame)), false, clock.nextFrame);
    takeLogIntentReveal(stepWith(fromMount));
    clock.flush();
    expect(fromMount).toHaveBeenCalledTimes(1);
    expect(fromFrame).not.toHaveBeenCalled();
  });
});
