// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PathnameContext, PathParamsContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ConsentAwareVercelAnalytics, { consentAwareBeforeSend } from "@/components/ConsentAwareVercelAnalytics";
import ConsentAwareVercelSpeedInsights, { consentAwareSpeedInsightsBeforeSend } from "@/components/ConsentAwareVercelSpeedInsights";
import { setAnalyticsConsent } from "@/lib/analytics";

type SdkWindow = Window & {
  va?: (...args: unknown[]) => void;
  si?: (...args: unknown[]) => void;
  vaq?: unknown[][];
  siq?: unknown[][];
};
const sdkWindow = window as SdkWindow;
let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  // jsdom does not load script resources. Fetch is an additional tripwire.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External calls are forbidden"); }));
  vi.spyOn(document, "referrer", "get").mockReturnValue("");
  history.replaceState(null, "", "/map");
  localStorage.clear();
  delete sdkWindow.va;
  delete sdkWindow.si;
  delete sdkWindow.vaq;
  delete sdkWindow.siq;
  setAnalyticsConsent(true);
});

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  root = undefined;
  setAnalyticsConsent(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.replaceChildren();
  document.head.querySelectorAll("script").forEach((script) => script.remove());
});

it("real SDKs register callbacks that still deny revoked consent and private SPA context after unmount", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <PathnameContext.Provider value="/map">
        <PathParamsContext.Provider value={{}}>
          <SearchParamsContext.Provider value={new URLSearchParams()}>
            <ConsentAwareVercelAnalytics /><ConsentAwareVercelSpeedInsights />
          </SearchParamsContext.Provider>
        </PathParamsContext.Provider>
      </PathnameContext.Provider>,
    );
  });
  const pageview = sdkWindow.vaq?.find((entry) => entry[0] === "beforeSend")?.[1] as typeof consentAwareBeforeSend;
  const vital = sdkWindow.siq?.find((entry) => entry[0] === "beforeSend")?.[1] as typeof consentAwareSpeedInsightsBeforeSend;
  expect(pageview).toBe(consentAwareBeforeSend);
  expect(vital).toBe(consentAwareSpeedInsightsBeforeSend);
  expect(pageview({ type: "pageview", url: "/map" })).not.toBeNull();
  expect(vital({ type: "vital", url: "/map", route: "/map" })).not.toBeNull();
  expect([...document.scripts].map((script) => new URL(script.src).pathname).sort()).toEqual([
    "/_vercel/insights/script.js", "/_vercel/speed-insights/script.js",
  ]);

  await act(async () => { root?.unmount(); });
  root = undefined;
  setAnalyticsConsent(false);
  expect(pageview({ type: "pageview", url: "/map" })).toBeNull();
  expect(vital({ type: "vital", url: "/map" })).toBeNull();
  setAnalyticsConsent(true);
  history.replaceState(null, "", "/profile");
  expect(pageview({ type: "pageview", url: "/map" })).toBeNull();
  expect(vital({ type: "vital", url: "/map" })).toBeNull();
  history.replaceState(null, "", "/map?fixture=private");
  expect(pageview({ type: "pageview", url: "/map" })).toBeNull();
  expect(vital({ type: "vital", url: "/map" })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
