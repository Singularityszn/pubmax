import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAnalyticsConsent } from "@/lib/analytics";
import { consentAwareBeforeSend } from "@/components/ConsentAwareVercelAnalytics";
import { consentAwareSpeedInsightsBeforeSend } from "@/components/ConsentAwareVercelSpeedInsights";

function setLocation(url: string): void {
  const parsed = new URL(url);
  Object.assign(window, { location: {
    href: url, origin: parsed.origin, pathname: parsed.pathname,
    search: parsed.search, hash: parsed.hash,
  } });
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("navigator", { doNotTrack: "0" });
  vi.stubGlobal("window", {
    location: {}, document: { referrer: "" },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  setLocation("https://pubmaxxing.com/map");
  setAnalyticsConsent(true);
});

afterEach(() => {
  setAnalyticsConsent(false);
  vi.unstubAllGlobals();
});

describe("Vercel telemetry callbacks", () => {
  it.each([
    "/profile", "/you", "/messages/person-fixture", "/plan/fixture",
    "/u/fixture", "/admin", "/map?lat=51.5", "/map?", "/map#fixture", "/map#",
    "https://foreign.example/map", "//foreign.example/map", "javascript:/map",
    "not a URL", "/%6dap", "/private/../map", " /map", "/map\\", "/map\n",
    "https://user:password@pubmaxxing.com/map", "https://pubmaxxing.com:444/map",
    "data:text/plain,fixture", "/map/",
  ])("denies unsafe event URL %s on a public page", (url) => {
    expect(consentAwareBeforeSend({ type: "pageview", url })).toBeNull();
    expect(consentAwareSpeedInsightsBeforeSend({ type: "vital", url })).toBeNull();
  });

  it.each(["/profile", "/map?query=fixture", "/map#fixture"])(
    "denies buffered public events when current page is %s", (path) => {
      setLocation(`https://pubmaxxing.com${path}`);
      expect(consentAwareBeforeSend({ type: "pageview", url: "/map" })).toBeNull();
      expect(consentAwareSpeedInsightsBeforeSend({ type: "vital", url: "/map" })).toBeNull();
    },
  );

  it.each([
    "https://pubmaxxing.com/profile", "https://pubmaxxing.com/map?fixture=private",
    "https://pubmaxxing.com/map#fixture", "https://foreign.example/map", "malformed",
    "https://pubmaxxing.com/map?", "https://pubmaxxing.com/map#",
  ])("denies unsafe document referrer %s", (referrer) => {
    Object.assign(window.document, { referrer });
    expect(consentAwareBeforeSend({ type: "pageview", url: "/map" })).toBeNull();
    expect(consentAwareSpeedInsightsBeforeSend({ type: "vital", url: "/map" })).toBeNull();
  });

  it.each([null, false, 0])("denies malformed runtime referrer %s", (referrer) => {
    Object.assign(window.document, { referrer });
    expect(consentAwareBeforeSend({ type: "pageview", url: "/map" })).toBeNull();
    expect(consentAwareSpeedInsightsBeforeSend({ type: "vital", url: "/map" })).toBeNull();
  });

  it("allows direct public visits and safe public referrers", () => {
    expect(consentAwareBeforeSend({ type: "pageview", url: "/map" })).toEqual({ type: "pageview", url: "/map" });
    Object.assign(window.document, { referrer: "https://pubmaxxing.com/tonight" });
    expect(consentAwareSpeedInsightsBeforeSend({ type: "vital", url: "/map", route: "/map" })).toEqual({ type: "vital", url: "/map", route: "/map" });
    Object.assign(window.document, { referrer: undefined });
    expect(consentAwareBeforeSend({ type: "pageview", url: "/map" })).not.toBeNull();
  });

  it.each(["/map?fixture=private", "/map#fixture", "/profile", "/[handle]", "https://foreign.example/map"])(
    "denies unsafe vital route %s", (route) => {
      expect(consentAwareSpeedInsightsBeforeSend({ type: "vital", url: "/map", route })).toBeNull();
    },
  );

  it("allows absolute public event URLs", () => {
    const url = "https://pubmaxxing.com/tonight";
    expect(consentAwareBeforeSend({ type: "pageview", url })).toEqual({ type: "pageview", url });
    expect(consentAwareSpeedInsightsBeforeSend({ type: "vital", url })).toEqual({ type: "vital", url });
  });

  it("still denies DNT after consent", () => {
    Object.assign(navigator, { doNotTrack: "1" });
    expect(consentAwareBeforeSend({ type: "pageview", url: "/map" })).toBeNull();
    expect(consentAwareSpeedInsightsBeforeSend({ type: "vital", url: "/map" })).toBeNull();
  });

  it("denies custom events and private vital routes", () => {
    expect(consentAwareBeforeSend({ type: "event", url: "/map" })).toBeNull();
    expect(consentAwareSpeedInsightsBeforeSend({ type: "vital", url: "/map", route: "/profile" })).toBeNull();
  });

  it("drops undeclared callback fields instead of forwarding their URLs", () => {
    const event = { type: "pageview" as const, url: "/map", referrer: "https://foreign.example/private" };
    expect(consentAwareBeforeSend(event)).toEqual({ type: "pageview", url: "/map" });
    const vital = { type: "vital" as const, url: "/map", route: "/map", referrer: "/profile", arbitraryUrl: "https://foreign.example/private" };
    expect(consentAwareSpeedInsightsBeforeSend(vital)).toEqual({ type: "vital", url: "/map", route: "/map" });
  });

  it("rechecks consent and SPA location through retained callback references", () => {
    const retainedPageview = consentAwareBeforeSend;
    const retainedVital = consentAwareSpeedInsightsBeforeSend;
    setAnalyticsConsent(false);
    expect(retainedPageview({ type: "pageview", url: "/map" })).toBeNull();
    expect(retainedVital({ type: "vital", url: "/map" })).toBeNull();
    setAnalyticsConsent(true);
    setLocation("https://pubmaxxing.com/profile");
    expect(retainedPageview({ type: "pageview", url: "/map" })).toBeNull();
    expect(retainedVital({ type: "vital", url: "/map" })).toBeNull();
  });
});
