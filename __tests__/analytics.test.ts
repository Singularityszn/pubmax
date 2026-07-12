import { afterEach, describe, expect, it, vi } from "vitest";

import { laneSourceFromSearch, trackEvent } from "@/lib/analytics";

type FakeNavigator = Partial<Navigator> & {
  sendBeacon?: (url: string, data?: BodyInit | null) => boolean;
  doNotTrack?: string;
};

function setWindow(navigatorOverrides: FakeNavigator = {}): void {
  const nav: FakeNavigator = {
    sendBeacon: vi.fn().mockReturnValue(true),
    ...navigatorOverrides,
  };
  (globalThis as { navigator?: unknown }).navigator = nav;
  (globalThis as { window?: unknown }).window = {
    location: { pathname: "/tonight" },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe("trackEvent", () => {
  it("no-ops when window is undefined (SSR / tests) and never throws", () => {
    expect(() => trackEvent("cmdk_open")).not.toThrow();
  });

  it("sends a known event via sendBeacon with allow-listed props", () => {
    setWindow();
    trackEvent("booking_click", { venueId: "venue-1", tier: "direct" });
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe("/api/events");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("forwards with empty props when none are given", () => {
    setWindow();
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
    expect(() => trackEvent("tour_complete", { completed: true })).not.toThrow();
  });

  it("fires lane_to_plan event with source + stops props via sendBeacon", () => {
    setWindow();
    trackEvent("lane_to_plan", { source: "tonight-lane", stops: 3 });
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe("/api/events");
    expect(blob).toBeInstanceOf(Blob);
  });
});

describe("laneSourceFromSearch", () => {
  it("returns the canonical token for exact allowlisted src values", () => {
    expect(laneSourceFromSearch("?src=tonight-lane")).toBe("tonight-lane");
    expect(laneSourceFromSearch("?src=whats-on-quiz&x=1")).toBe("whats-on-quiz");
    expect(laneSourceFromSearch("?src=whats-on-sport")).toBe("whats-on-sport");
    expect(laneSourceFromSearch("?src=whats-on-deal")).toBe("whats-on-deal");
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
