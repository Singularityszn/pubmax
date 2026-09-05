// GAP 18 (mobile store-readiness audit, 2026-09-04, 390x844): `/map?log=1` is
// the working entry to the core loop, and the venue sheet opened with the Pint
// Drop composer's price step starting at y=696 in an 844px viewport and running
// 237px tall, so the price field sat on the bottom edge and "Log it" was off
// screen behind the sheet's own action bar. The reader had said the one thing
// they came to say and then had to scroll to act on it.
//
// The fix is a REVEAL and never a re-layout, and this is its contract.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  LOG_INTENT_PRICE_STEP_SELECTOR,
  LOG_INTENT_REVEAL_BUDGET_MS,
  browserRevealTimers,
  logIntentRevealBehavior,
  revealLogIntentPriceStep,
  scheduleLogIntentReveal,
  type LogIntentRevealTimers,
} from "@/lib/logIntentReveal";

const REPO_ROOT = join(__dirname, "..");

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

type FakeClock = LogIntentRevealTimers & {
  run: (steps: number) => void;
  readonly pending: number;
};

function fakeClock(): FakeClock {
  let time = 0;
  let nextId = 1;
  const queue = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout: (callback, ms) => {
      const id = nextId;
      nextId += 1;
      queue.set(id, { at: time + ms, callback });
      return id;
    },
    clearTimeout: (id) => {
      queue.delete(id as number);
    },
    now: () => time,
    run: (steps) => {
      for (let step = 0; step < steps; step += 1) {
        const next = [...queue.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) return;
        queue.delete(next[0]);
        time = next[1].at;
        next[1].callback();
      }
    },
    get pending() {
      return queue.size;
    },
  };
}

function rootWith(step: { scrollIntoView?: unknown } | null) {
  return {
    querySelector: (selector: string) =>
      selector === LOG_INTENT_PRICE_STEP_SELECTOR ? (step as Element | null) : null,
  };
}

describe("reduced motion changes the glide, never the move", () => {
  it("jumps rather than glides when the reader asked for less motion", () => {
    expect(logIntentRevealBehavior(true)).toBe("auto");
    expect(logIntentRevealBehavior(false)).toBe("smooth");
  });
});

describe("one reveal attempt", () => {
  it("scrolls the composer's price step to the top of its scroller", () => {
    const scrollIntoView = vi.fn();
    expect(revealLogIntentPriceStep(rootWith({ scrollIntoView }), false)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("answers false when the composer has not mounted yet", () => {
    expect(revealLogIntentPriceStep(rootWith(null), false)).toBe(false);
  });

  it("answers false rather than throwing where scrollIntoView is absent", () => {
    expect(revealLogIntentPriceStep(rootWith({}), false)).toBe(false);
  });
});

describe("waiting for the composer", () => {
  it("keeps looking until the composer mounts, then reveals once", () => {
    const scrollIntoView = vi.fn();
    let step: { scrollIntoView: () => void } | null = null;
    const clock = fakeClock();
    scheduleLogIntentReveal({
      root: { querySelector: () => step as unknown as Element | null },
      reducedMotion: false,
      timers: clock,
    });

    clock.run(3);
    expect(scrollIntoView).not.toHaveBeenCalled();

    step = { scrollIntoView };
    clock.run(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // Landed, so nothing is left waiting to scroll the sheet a second time.
    expect(clock.pending).toBe(0);
  });

  it("gives up inside its budget rather than waiting for ever", () => {
    const clock = fakeClock();
    scheduleLogIntentReveal({
      root: rootWith(null),
      reducedMotion: false,
      timers: clock,
    });
    clock.run(500);
    expect(clock.now()).toBeLessThanOrEqual(LOG_INTENT_REVEAL_BUDGET_MS + 100);
    expect(clock.pending).toBe(0);
  });

  it("stops when the reader closes the sheet, so no late scroll lands", () => {
    const scrollIntoView = vi.fn();
    const clock = fakeClock();
    const cancel = scheduleLogIntentReveal({
      root: rootWith({ scrollIntoView }),
      reducedMotion: false,
      timers: clock,
    });
    cancel();
    clock.run(10);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("the browser timers seam", () => {
  it("reads the window's own clock", () => {
    const timers = browserRevealTimers();
    const id = timers.setTimeout(() => {}, 5_000);
    expect(id).toBeDefined();
    timers.clearTimeout(id);
    expect(timers.now()).toBeGreaterThan(0);
  });
});

describe("the map wires the reveal to the log intent and nothing else", () => {
  const pubMap = read("components/PubMap.tsx");
  const start = pubMap.indexOf("const openComposerForLog = useCallback(");
  const body = pubMap.slice(start, pubMap.indexOf("}, [closePlanning", start));

  it("reveals from openComposerForLog, the one door the intent opens", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("scheduleLogIntentReveal({");
    expect(body).toContain("browserPrefersReducedMotion()");
  });

  it("moves no focus, so the soft keyboard stays the reader's own next move", () => {
    expect(body).not.toContain(".focus(");
  });

  it("keeps the sheet's own detent and tab decisions unchanged", () => {
    expect(body).toContain('setVenueInitialTab("pints")');
    expect(body).toContain('setSheetSnap("full")');
  });
});
