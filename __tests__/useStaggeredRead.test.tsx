// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { READ_PHASE_DELAY_MS, useStaggeredRead, type ReadPhase } from "@/lib/useStaggeredRead";

// A venue sheet used to put every panel's read on the wire in one frame. A phase
// is how long after the sheet opened a panel may start, and a new venue restarts
// the clock.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

function Probe({ phase, scope }: { phase: ReadPhase; scope: string }) {
  return createElement("span", null, String(useStaggeredRead(phase, scope)));
}

const seen = () => container.textContent === "true";

function render(phase: ReadPhase, scope: string) {
  act(() => root.render(createElement(Probe, { phase, scope })));
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useStaggeredRead", () => {
  it("lets phase 0 start at once", () => {
    render(0, "venue-a");
    expect(seen()).toBe(true);
  });

  it("holds a later phase until its delay has passed", () => {
    render(2, "venue-a");
    expect(seen()).toBe(false);
    act(() => vi.advanceTimersByTime(READ_PHASE_DELAY_MS[2] - 1));
    expect(seen()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(seen()).toBe(true);
  });

  it("restarts the wait when the venue changes", () => {
    render(1, "venue-a");
    act(() => vi.advanceTimersByTime(READ_PHASE_DELAY_MS[1]));
    expect(seen()).toBe(true);
    render(1, "venue-b");
    expect(seen()).toBe(false);
    act(() => vi.advanceTimersByTime(READ_PHASE_DELAY_MS[1]));
    expect(seen()).toBe(true);
  });

  it("orders the phases and keeps the last one short enough to land before a scroll", () => {
    expect([...READ_PHASE_DELAY_MS]).toEqual([...READ_PHASE_DELAY_MS].sort((a, b) => a - b));
    expect(Math.max(...READ_PHASE_DELAY_MS)).toBeLessThanOrEqual(2_000);
  });
});
