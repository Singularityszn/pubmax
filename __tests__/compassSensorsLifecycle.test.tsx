// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCompassSensors } from "@/components/compass/useCompassSensors";

// The iOS motion permission answers LATER than the tap that asked for it. If
// the reader leaves /compass before it answers, the answer must not attach
// listeners or a timer that nothing will ever remove (review P2, 30 Oct 2026).

const ORIENTATION_EVENTS = ["deviceorientation", "deviceorientationabsolute"];

let container: HTMLDivElement;
let root: Root | null;
const handle: { start: (() => void) | null } = { start: null };
let resolvePermission: ((answer: string) => void) | null;
let added: string[];
let removed: string[];

function Probe({ onStart }: { onStart: (start: () => void) => void }) {
  const { start } = useCompassSensors();
  useEffect(() => {
    onStart(start);
  }, [onStart, start]);
  return null;
}

function keepStart(start: () => void): void {
  handle.start = start;
}

function orientationCalls(calls: string[]): string[] {
  return calls.filter((type) => ORIENTATION_EVENTS.includes(type));
}

beforeEach(() => {
  vi.useFakeTimers();
  added = [];
  removed = [];
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    added.push(type);
    add(type, listener, options);
  });
  vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, options) => {
    removed.push(type);
    remove(type, listener, options);
  });
  // The iOS shape: a permission ask that settles when the test says so.
  Object.defineProperty(window, "DeviceOrientationEvent", {
    configurable: true,
    value: {
      requestPermission: () =>
        new Promise<string>((resolve) => {
          resolvePermission = resolve;
        }),
    },
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn(() => 7), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  });
  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe, { onStart: keepStart }));
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
  handle.start = null;
  resolvePermission = null;
});

describe("the compass sensors outlive nothing", () => {
  it("a permission that answers after the page has gone attaches nothing", async () => {
    act(() => handle.start?.());
    expect(resolvePermission).toBeTypeOf("function");

    act(() => root?.unmount());
    root = null;

    await act(async () => {
      resolvePermission?.("granted");
      await Promise.resolve();
    });

    expect(orientationCalls(added)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a permission that answers while the page is open listens, and leaving removes it all", async () => {
    act(() => handle.start?.());
    await act(async () => {
      resolvePermission?.("granted");
      await Promise.resolve();
    });

    expect(orientationCalls(added).sort()).toEqual([...ORIENTATION_EVENTS].sort());
    expect(vi.getTimerCount()).toBe(1);

    act(() => root?.unmount());
    root = null;

    expect(orientationCalls(removed).sort()).toEqual([...ORIENTATION_EVENTS].sort());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a second Start retires the first ask, so a late first answer attaches nothing", async () => {
    act(() => handle.start?.());
    const firstAnswer = resolvePermission;
    act(() => handle.start?.());
    const secondAnswer = resolvePermission;

    await act(async () => {
      firstAnswer?.("granted");
      await Promise.resolve();
    });
    expect(orientationCalls(added)).toEqual([]);

    await act(async () => {
      secondAnswer?.("granted");
      await Promise.resolve();
    });
    expect(orientationCalls(added).sort()).toEqual([...ORIENTATION_EVENTS].sort());
  });
});
