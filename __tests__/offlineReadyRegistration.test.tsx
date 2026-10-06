// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OfflineReady, {
  OFFLINE_REGISTER_FALLBACK_DELAY_MS,
} from "@/components/OfflineReady";
import { defined } from "@/__tests__/helpers/defined";

// GAP 8: the service worker is the whole offline story, and it used to be
// armed by `pubmax:first-pins` alone - an event only components/PubMap.tsx
// emits. The native shell cold-starts on /tonight, so a reader who never
// opened the Map registered nothing and had no offline shell at all.
//
// These tests drive the real component in jsdom against a fake
// navigator.serviceWorker, so what they prove is registration itself rather
// than the shape of a predicate. The map's own cold-path protection is proved
// too: a route that has loaded but not settled must NOT have registered yet.

const registrationDouble = {
  addEventListener: vi.fn(),
};

let register: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;

function mount() {
  act(() => {
    root.render(createElement(OfflineReady));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  register = vi.fn().mockResolvedValue(registrationDouble);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  // Production-only by design; the component returns early otherwise.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "test-build-id");
  // requestIdleCallback is absent in jsdom, which is the setTimeout(0) lane
  // the component already carries for browsers without it.
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as { __pubmaxFirstPinsReady?: boolean }).__pubmaxFirstPinsReady;
  window.localStorage.clear();
});

describe("OfflineReady registration", () => {
  it("registers on a fresh session on / with no map visit and no first-pins event", async () => {
    // A fresh session: nothing in storage, no in-memory pin signal, and the
    // document already complete - jsdom's default readyState.
    expect(window.localStorage.getItem("pubmax:first-pins-seen:v1")).toBeNull();

    mount();
    expect(register).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(OFFLINE_REGISTER_FALLBACK_DELAY_MS);
      await vi.runAllTimersAsync();
    });

    expect(register).toHaveBeenCalledTimes(1);
    const url = defined(register.mock.calls[0])[0] as string;
    expect(url).toBe("/sw.js?v=test-build-id&cache-policy=plan-preview-safe-v2");
  });

  it("keeps the cold path clear: a loaded route has not registered before the fallback delay", async () => {
    mount();

    await act(async () => {
      vi.advanceTimersByTime(OFFLINE_REGISTER_FALLBACK_DELAY_MS - 1);
    });

    expect(register).not.toHaveBeenCalled();
  });

  it("still registers immediately when the map reports its first pins", async () => {
    mount();

    await act(async () => {
      window.dispatchEvent(new Event("pubmax:first-pins"));
      await vi.runAllTimersAsync();
    });

    expect(register).toHaveBeenCalledTimes(1);
  });

  it("registers once when both triggers fire", async () => {
    mount();

    await act(async () => {
      window.dispatchEvent(new Event("pubmax:first-pins"));
      vi.advanceTimersByTime(OFFLINE_REGISTER_FALLBACK_DELAY_MS * 2);
      await vi.runAllTimersAsync();
    });

    expect(register).toHaveBeenCalledTimes(1);
  });

  it("registers nothing outside a production build", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mount();

    await act(async () => {
      vi.advanceTimersByTime(OFFLINE_REGISTER_FALLBACK_DELAY_MS * 2);
      await vi.runAllTimersAsync();
    });

    expect(register).not.toHaveBeenCalled();
  });
});
