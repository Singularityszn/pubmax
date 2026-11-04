// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HEADING_STALE_MS,
  useCompassSensors,
  type HeadingSensor,
} from "@/components/compass/useCompassSensors";

// The iOS motion permission answers LATER than the tap that asked for it. If
// the reader leaves /compass before it answers, the answer must not attach
// listeners or a timer that nothing will ever remove (review P2, 30 Oct 2026).

const ORIENTATION_EVENTS = ["deviceorientation", "deviceorientationabsolute"];

let container: HTMLDivElement;
let root: Root | null;
const handle: {
  start: (() => void) | null;
  sensor: HeadingSensor | null;
  heading: number | null;
} = { start: null, sensor: null, heading: null };
let resolvePermission: ((answer: string) => void) | null;
let added: string[];
let removed: string[];

type Reading = { start: () => void; sensor: HeadingSensor; heading: number | null };

function Probe({ onState }: { onState: (reading: Reading) => void }) {
  const { start, sensor, heading } = useCompassSensors();
  useEffect(() => {
    onState({ start, sensor, heading });
  }, [onState, start, sensor, heading]);
  return null;
}

function keepState(reading: Reading): void {
  handle.start = reading.start;
  handle.sensor = reading.sensor;
  handle.heading = reading.heading;
}

function face(webkitCompassHeading: number): void {
  const event = new Event("deviceorientation");
  Object.assign(event, { webkitCompassHeading, alpha: null, absolute: false });
  act(() => {
    window.dispatchEvent(event);
  });
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
    root.render(createElement(Probe, { onState: keepState }));
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
  handle.start = null;
  handle.sensor = null;
  handle.heading = null;
  delete (window as unknown as { orientation?: unknown }).orientation;
  delete (window.screen as unknown as { orientation?: unknown }).orientation;
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

describe("a heading that stops arriving", () => {
  async function startListening(): Promise<void> {
    act(() => handle.start?.());
    await act(async () => {
      resolvePermission?.("granted");
      await Promise.resolve();
    });
  }

  it("falls back to words once the readings stop, and comes back with the next one", async () => {
    await startListening();
    face(90);
    expect(handle.sensor).toBe("live");

    // Readings keep it live.
    act(() => vi.advanceTimersByTime(HEADING_STALE_MS - 500));
    face(91);
    act(() => vi.advanceTimersByTime(HEADING_STALE_MS - 500));
    expect(handle.sensor).toBe("live");

    // Silence past the limit: the needle may not keep claiming a heading.
    act(() => vi.advanceTimersByTime(600));
    expect(handle.sensor).toBe("none");

    // iOS sends -1 while it calibrates: that is no reading at all.
    face(-1);
    expect(handle.sensor).toBe("none");

    face(92);
    expect(handle.sensor).toBe("live");
  });

  it("reads the older window.orientation when screen.orientation is missing", async () => {
    Object.defineProperty(window.screen, "orientation", { configurable: true, value: undefined });
    Object.defineProperty(window, "orientation", { configurable: true, value: 90 });
    await startListening();
    face(350);
    act(() => vi.advanceTimersByTime(50));
    expect(handle.heading).toBe(80);
  });
});
