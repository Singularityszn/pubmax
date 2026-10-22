// @vitest-environment jsdom

import * as React from "react";
import { act, createElement, StrictMode, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metric } from "web-vitals/attribution";

const registrations = () => ({
  onCLS: vi.fn<(callback: (metric: Metric) => void) => void>(),
  onFCP: vi.fn<(callback: (metric: Metric) => void) => void>(),
  onINP: vi.fn<(callback: (metric: Metric) => void) => void>(),
  onLCP: vi.fn<(callback: (metric: Metric) => void) => void>(),
  onTTFB: vi.fn<(callback: (metric: Metric) => void) => void>(),
});

let root: Root | null = null;
let host: HTMLDivElement;
let releaseImport: (() => void) | null = null;
let originalBeacon: PropertyDescriptor | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  originalBeacon = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/plan/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?private=secret");
  vi.resetModules();
  // The reset isolates import outcomes while the renderer keeps its React instance.
  vi.doMock("react", () => React);
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  releaseImport?.();
  releaseImport = null;
  await vi.dynamicImportSettled();
  host.remove();
  if (originalBeacon) Object.defineProperty(navigator, "sendBeacon", originalBeacon);
  else Reflect.deleteProperty(navigator, "sendBeacon");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("web-vitals/attribution");
  vi.doUnmock("react");
});

async function component(): Promise<ComponentType> {
  let loaded: ComponentType | null = null;
  const pending = import("@/components/PerformanceVitals").then((module) => {
    loaded = module.default;
  });
  // The eager shell component must load even while optional telemetry is held.
  await vi.waitFor(() => expect(loaded).not.toBeNull(), { timeout: 500 });
  await pending;
  return loaded!;
}

async function mount(Vitals: ComponentType, strict = false): Promise<void> {
  await act(async () => {
    root = createRoot(host);
    const content = createElement(React.Fragment, null,
      createElement("main", null, "Plan remains available"), createElement(Vitals));
    root.render(strict ? createElement(StrictMode, null, content) : content);
  });
}

function heldLibrary() {
  const methods = registrations();
  let requested = 0;
  const gate = new Promise<void>((resolve) => { releaseImport = resolve; });
  vi.doMock("web-vitals/attribution", async () => {
    requested += 1;
    await gate;
    return methods;
  });
  return { methods, requested: () => requested };
}

async function release(): Promise<void> {
  await act(async () => {
    releaseImport?.();
    await vi.dynamicImportSettled();
  });
}

describe("the eager field-vitals component", () => {
  it("mounts without the held library and registers nothing after unmount", async () => {
    const library = heldLibrary();
    await mount(await component());
    expect(host.textContent).toBe("Plan remains available");
    await vi.waitFor(() => expect(library.requested()).toBe(1));
    for (const method of Object.values(library.methods)) expect(method).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    root = null;
    await release();
    for (const method of Object.values(library.methods)) expect(method).not.toHaveBeenCalled();
  });

  it("registers each metric once for the surviving StrictMode effect", async () => {
    // Vitest's manual factory bypasses a concurrent second import. Its cached
    // automock keeps both real dynamic-import promises on the same namespace.
    vi.doMock("web-vitals/attribution");
    const library = await import("web-vitals/attribution");
    const methods = {
      onCLS: vi.mocked(library.onCLS), onFCP: vi.mocked(library.onFCP),
      onINP: vi.mocked(library.onINP), onLCP: vi.mocked(library.onLCP),
      onTTFB: vi.mocked(library.onTTFB),
    };
    await mount(await component(), true);
    await act(async () => { await vi.dynamicImportSettled(); });
    for (const method of Object.values(methods)) expect(method).toHaveBeenCalledTimes(1);
    const callbacks = Object.values(methods).map((method) => method.mock.calls[0]![0]);
    expect(new Set(callbacks).size).toBe(1);
  });

  it("handles a refused library without interrupting the mounted page", async () => {
    vi.doMock("web-vitals/attribution", async () => { throw new Error("attribution chunk refused"); });
    const Vitals = await component();
    await mount(Vitals);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(host.textContent).toBe("Plan remains available");
  });

  it("keeps sanitized reporting and sends no requests when consent is denied", async () => {
    const library = heldLibrary();
    const Vitals = await component();
    const analytics = await import("@/lib/analytics");
    analytics.setAnalyticsConsent(false);
    const track = vi.spyOn(analytics, "trackEvent");
    const fetchSpy = vi.fn();
    const beaconSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beaconSpy });
    await mount(Vitals);
    await release();
    const report = library.methods.onLCP.mock.calls[0]![0];
    const metric: Metric & { attribution: { element: string } } = {
      name: "LCP", value: 2345.6, delta: 2345.6, id: "test-metric", rating: "good",
      entries: [], navigationType: "navigate", navigationId: 0, attribution: { element: "main>img.hero" },
    };
    report(metric);
    expect(track).toHaveBeenCalledWith("web_vital", {
      metric: "LCP", value: 2346, rating: "good", route: "/plan/[id]", target: "main>img.hero",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    expect(analytics.analyticsCollectionAllowed()).toBe(false);
  });
});
