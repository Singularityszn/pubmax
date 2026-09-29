// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => createElement("div", { "data-testid": "live-drops" }, "Live drops"),
}));

import DeferredPintDropStrip from "@/components/landing/DeferredPintDropStrip";

let root: Root;
let container: HTMLDivElement;
let observe: ReturnType<typeof vi.fn>;
let disconnect: ReturnType<typeof vi.fn>;
let notify: IntersectionObserverCallback;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  observe = vi.fn();
  disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("landing live Pint Drops", () => {
  it("holds its reserved rail until the reader approaches it", async () => {
    await act(async () => root.render(createElement(DeferredPintDropStrip)));
    expect(container.querySelector(".dropStripRail")).not.toBeNull();
    expect(container.querySelector('[data-testid="live-drops"]')).toBeNull();
    expect(observe).toHaveBeenCalledWith(container.querySelector(".lpDrops"));
    await act(async () => notify([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(container.querySelector('[data-testid="live-drops"]')).toBeNull();
    await act(async () => notify([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(container.querySelector('[data-testid="live-drops"]')).not.toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  it("still opens the feed when the browser has no observer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    await act(async () => root.render(createElement(DeferredPintDropStrip)));
    await act(async () => vi.runAllTimers());
    expect(container.querySelector('[data-testid="live-drops"]')).not.toBeNull();
  });
});
