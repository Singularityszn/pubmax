// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: false, listeners: new Set<() => void>() }));
vi.mock("@/lib/analytics", () => ({
  analyticsCollectionAllowed: () => state.allowed,
  flushVerifiedAnalyticsOutbox: async () => {},
  subscribeAnalyticsConsent: (listener: () => void) => {
    state.listeners.add(listener);
    return () => { state.listeners.delete(listener); };
  },
}));
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => createElement("span", { "data-sdk": "analytics" }) }));
vi.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => createElement("span", { "data-sdk": "speed" }) }));

import ConsentAwareVercelAnalytics from "@/components/ConsentAwareVercelAnalytics";
import ConsentAwareVercelSpeedInsights from "@/components/ConsentAwareVercelSpeedInsights";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.allowed = false;
  state.listeners.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
});

describe("consent-aware Vercel scripts", () => {
  it("does not mount either SDK until consent, then unmounts both on withdrawal", async () => {
    await act(async () => root.render(createElement("div", null,
      createElement(ConsentAwareVercelAnalytics), createElement(ConsentAwareVercelSpeedInsights))));
    expect(host.querySelectorAll("[data-sdk]")).toHaveLength(0);
    await act(async () => {
      state.allowed = true;
      state.listeners.forEach((listener) => listener());
    });
    await vi.waitFor(() => expect(host.querySelectorAll("[data-sdk]")).toHaveLength(2));
    await act(async () => {
      state.allowed = false;
      state.listeners.forEach((listener) => listener());
    });
    expect(host.querySelectorAll("[data-sdk]")).toHaveLength(0);
  });
});
