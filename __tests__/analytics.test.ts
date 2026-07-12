import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the @vercel/analytics `track` export so we can assert on calls without
// a real browser/DSN, and so the SSR/no-window guard is exercised directly
// (the vitest environment here is "node" — window is undefined by default).
const trackMock = vi.fn();
vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

import { laneSourceFromSearch, trackEvent } from "@/lib/analytics";

describe("trackEvent", () => {
  afterEach(() => {
    trackMock.mockReset();
    delete (globalThis as { window?: unknown }).window;
  });

  it("no-ops when window is undefined (SSR / tests) and never throws", () => {
    expect(() => trackEvent("cmdk_open")).not.toThrow();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("forwards name + props to track() when a browser window is present", () => {
    (globalThis as { window?: unknown }).window = {};
    trackEvent("booking_click", { venueId: "venue-1", tier: "direct" });
    expect(trackMock).toHaveBeenCalledWith("booking_click", {
      venueId: "venue-1",
      tier: "direct",
    });
  });

  it("forwards with no props when none are given", () => {
    (globalThis as { window?: unknown }).window = {};
    trackEvent("tour_complete");
    expect(trackMock).toHaveBeenCalledWith("tour_complete", undefined);
  });

  it("swallows errors thrown by track() (analytics must never break the app)", () => {
    (globalThis as { window?: unknown }).window = {};
    trackMock.mockImplementationOnce(() => {
      throw new Error("blocked by adblocker");
    });
    expect(() => trackEvent("plan_created", { count: 3 })).not.toThrow();
  });

  it("fires lane_to_plan event with source + stops props", () => {
    (globalThis as { window?: unknown }).window = {};
    trackEvent("lane_to_plan", { source: "tonight-lane", stops: 3 });
    expect(trackMock).toHaveBeenCalledWith("lane_to_plan", {
      source: "tonight-lane",
      stops: 3,
    });
  });
});

describe("laneSourceFromSearch", () => {
  it("returns the src when it names a known lane surface", () => {
    expect(laneSourceFromSearch("?src=tonight-lane")).toBe("tonight-lane");
    expect(laneSourceFromSearch("?src=whats-on-quiz&x=1")).toBe("whats-on-quiz");
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
});
