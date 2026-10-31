// @vitest-environment jsdom

// Focus is never dropped on <body> by Last orders. Opening the list by tap
// takes focus to its heading; closing it hands focus back to the door. The
// door names no aria-controls target while the panel is not in the page.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/surfaceDataCache", () => ({ loadSurfaceJson: () => new Promise(() => {}) }));

// The real panel, without next/dynamic's lazy chunk.
vi.mock("next/dynamic", async () => {
  const panel = await import("@/app/tonight/TonightLastOrdersPanel");
  return { default: () => panel.default };
});

import TonightLastOrdersDoor from "@/app/tonight/TonightLastOrdersDoor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("Last orders focus", () => {
  it("moves focus to the heading on open and back to the door on close", async () => {
    act(() => {
      root.render(
        createElement(TonightLastOrdersDoor, { origin: null, near: null, onShareLocation: () => {}, locating: false }),
      );
    });
    await flush();
    const door = container.querySelector<HTMLButtonElement>('[data-testid="last-orders-door"]');
    expect(door).not.toBeNull();
    expect(door?.hasAttribute("aria-controls")).toBe(false);

    door?.focus();
    act(() => door?.click());
    await flush();
    const heading = container.querySelector("#last-orders-title");
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);

    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close Last orders"]');
    close?.focus();
    act(() => close?.click());
    await flush();
    const doorAgain = container.querySelector('[data-testid="last-orders-door"]');
    expect(doorAgain).not.toBeNull();
    expect(document.activeElement).toBe(doorAgain);
    expect(document.activeElement).not.toBe(document.body);
  });
});
