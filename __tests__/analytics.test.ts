import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyticsCollectionAllowed,
  anonymousAnalyticsId,
  laneSourceFromSearch,
  setAnalyticsConsent,
  trackEvent,
} from "@/lib/analytics";
import { consentAwareBeforeSend } from "@/components/ConsentAwareVercelAnalytics";

type FakeNavigator = Partial<Navigator> & {
  sendBeacon?: (url: string, data?: BodyInit | null) => boolean;
  doNotTrack?: string;
};

function setWindow(navigatorOverrides: FakeNavigator = {}): void {
  const values = new Map<string, string>();
  const nav: FakeNavigator = {
    sendBeacon: vi.fn().mockReturnValue(true),
    ...navigatorOverrides,
  };
  (globalThis as { navigator?: unknown }).navigator = nav;
  (globalThis as { window?: unknown }).window = {
    location: { pathname: "/tonight" },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
}

function makeStorageThrow(): void {
  const fail = () => { throw new Error("storage blocked"); };
  (globalThis as { window: { localStorage: unknown } }).window.localStorage = {
    getItem: fail,
    removeItem: fail,
    setItem: fail,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if ((globalThis as { window?: unknown }).window) setAnalyticsConsent(false);
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe("trackEvent", () => {
  it("no-ops when window is undefined (SSR / tests) and never throws", () => {
    expect(() => trackEvent("cmdk_open")).not.toThrow();
  });

  it("sends a known event via sendBeacon with allow-listed props", () => {
    setWindow();
    setAnalyticsConsent(true);
    trackEvent("booking_click", { venueId: "venue-1", tier: "direct" });
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe("/api/events");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("creates no persistent id before consent and clears it after revocation", () => {
    setWindow();
    expect(anonymousAnalyticsId()).toBeNull();

    setAnalyticsConsent(true);
    const first = anonymousAnalyticsId();
    const second = anonymousAnalyticsId();

    expect(first).toMatch(/^anon_[a-f0-9-]{16,64}$/);
    expect(second).toBe(first);
    expect(first).not.toContain("@");

    setAnalyticsConsent(false);
    expect(anonymousAnalyticsId()).toBeNull();
  });

  it("fails closed when storage is blocked unless consent was explicitly granted in memory", () => {
    setWindow();
    makeStorageThrow();
    expect(anonymousAnalyticsId()).toBeNull();

    setAnalyticsConsent(true);
    expect(anonymousAnalyticsId()).toMatch(/^anon_[a-f0-9-]{16,64}$/);

    setAnalyticsConsent(false);
    expect(anonymousAnalyticsId()).toBeNull();
  });

  it("forwards with empty props when none are given", () => {
    setWindow();
    setAnalyticsConsent(true);
    trackEvent("tour_complete");
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("drops an unknown event silently (never throws)", () => {
    setWindow();
    expect(() =>
      // @ts-expect-error intentionally invalid event name for this test
      trackEvent("not_a_real_event", { count: 3 }),
    ).not.toThrow();
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).not.toHaveBeenCalled();
  });

  it("honors Do-Not-Track and never calls sendBeacon", () => {
    setWindow({ doNotTrack: "1" });
    setAnalyticsConsent(true);
    trackEvent("plan_created", { count: 3 });
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).not.toHaveBeenCalled();
  });

  it("swallows errors thrown by sendBeacon (analytics must never break the app)", () => {
    setWindow({
      sendBeacon: vi.fn().mockImplementation(() => {
        throw new Error("blocked by adblocker");
      }),
    });
    setAnalyticsConsent(true);
    expect(() => trackEvent("tour_complete", { completed: true })).not.toThrow();
  });

  it("fires lane_to_plan event with source + stops props via sendBeacon", () => {
    setWindow();
    setAnalyticsConsent(true);
    trackEvent("lane_to_plan", { source: "tonight-lane", stops: 3 });
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe("/api/events");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("sends nothing to any analytics destination before consent", () => {
    setWindow();
    expect(analyticsCollectionAllowed()).toBe(false);
    trackEvent("tonight_screen_view");
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).not.toHaveBeenCalled();
    expect(consentAwareBeforeSend({ type: "pageview", url: "/tonight" })).toBeNull();
  });

  it("allows Vercel pageviews only after consent and still honors DNT", () => {
    setWindow();
    setAnalyticsConsent(true);
    const event = { type: "pageview" as const, url: "/tonight" };
    expect(analyticsCollectionAllowed()).toBe(true);
    expect(consentAwareBeforeSend(event)).toBe(event);

    (globalThis as { navigator: FakeNavigator }).navigator.doNotTrack = "1";
    expect(analyticsCollectionAllowed()).toBe(false);
    expect(consentAwareBeforeSend(event)).toBeNull();
  });
});

describe("laneSourceFromSearch", () => {
  it("returns the canonical token for exact allowlisted src values", () => {
    expect(laneSourceFromSearch("?src=tonight-lane")).toBe("tonight-lane");
    expect(laneSourceFromSearch("?src=whats-on-quiz&x=1")).toBe("whats-on-quiz");
    expect(laneSourceFromSearch("?src=whats-on-sport")).toBe("whats-on-sport");
    expect(laneSourceFromSearch("?src=whats-on-deal")).toBe("whats-on-deal");
    expect(laneSourceFromSearch("?src=whats-on-music")).toBe("whats-on-music");
  });

  it("returns null without a src param (default /plan visits stay silent)", () => {
    expect(laneSourceFromSearch("")).toBeNull();
    expect(laneSourceFromSearch("?other=1")).toBeNull();
  });

  it("returns null for unknown or empty src values", () => {
    expect(laneSourceFromSearch("?src=")).toBeNull();
    expect(laneSourceFromSearch("?src=nav")).toBeNull();
    expect(laneSourceFromSearch("?src=discover-editorial")).toBeNull();
  });

  it("rejects prefix-extended src values — raw query text never reaches telemetry", () => {
    expect(laneSourceFromSearch("?src=whats-on-jane.doe@example.com")).toBeNull();
    expect(laneSourceFromSearch("?src=tonight-lane-extra")).toBeNull();
    expect(laneSourceFromSearch("?src=whats-on")).toBeNull();
  });
});
