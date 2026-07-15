import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENTS,
  isKnownEvent,
  sanitizeEvent,
} from "@/lib/analyticsEvents";

describe("isKnownEvent", () => {
  it("accepts registry names and rejects everything else", () => {
    expect(isKnownEvent("tonight_screen_view")).toBe(true);
    expect(isKnownEvent("event_chip_view")).toBe(true);
    expect(isKnownEvent("__proto__")).toBe(false);
    expect(isKnownEvent("made_up")).toBe(false);
  });
});

describe("sanitizeEvent", () => {
  it("returns null for an unknown event", () => {
    expect(sanitizeEvent("nope", { kind: "gig" })).toBeNull();
  });

  it("keeps only allow-listed props for the event", () => {
    const ev = sanitizeEvent("event_chip_view", { kind: "gig", secret: "x" });
    expect(ev).toEqual({ name: "event_chip_view", props: { kind: "gig" } });
  });

  it("drops props on an event that carries none", () => {
    const ev = sanitizeEvent("tonight_screen_view", { kind: "gig" });
    expect(ev).toEqual({ name: "tonight_screen_view", props: {} });
  });

  it("rejects unsafe values: emails, over-long strings, non-finite numbers", () => {
    expect(sanitizeEvent("event_chip_view", { kind: "a@b.com" })?.props).toEqual({});
    expect(sanitizeEvent("event_chip_view", { kind: "x".repeat(41) })?.props).toEqual({});
    expect(sanitizeEvent("streak_increment", { days: Number.NaN })?.props).toEqual({});
    expect(sanitizeEvent("streak_increment", { days: Infinity })?.props).toEqual({});
  });

  it("accepts safe primitives (short string, finite number, boolean)", () => {
    expect(sanitizeEvent("streak_increment", { days: 5 })?.props).toEqual({ days: 5 });
    expect(sanitizeEvent("poster_shared", { surface: "borough" })?.props).toEqual({
      surface: "borough",
    });
  });

  it("keeps only bounded performance fields for web vitals", () => {
    expect(sanitizeEvent("web_vital", {
      metric: "INP",
      value: 143,
      rating: "good",
      attribution: "button#private-account-control",
    })?.props).toEqual({ metric: "INP", value: 143, rating: "good" });
  });

  it("tolerates missing/invalid props objects", () => {
    expect(sanitizeEvent("tonight_screen_view")).toEqual({
      name: "tonight_screen_view",
      props: {},
    });
    expect(sanitizeEvent("tonight_screen_view", null)).toEqual({
      name: "tonight_screen_view",
      props: {},
    });
  });

  it("allows district telemetry only from the reviewed catalogue and gate enums", () => {
    expect(sanitizeEvent("district_route_blocked", {
      district: "barnes",
      coverageStatus: "reviewed",
      demandWave: 0,
      reason: "opening_hours",
      coordinates: "51.474,-0.239",
      note: "free text is never telemetry",
    })).toEqual({
      name: "district_route_blocked",
      props: {
        district: "barnes",
        coverageStatus: "reviewed",
        demandWave: 0,
        reason: "opening_hours",
      },
    });

    expect(sanitizeEvent("route_ready_gate_failed", {
      district: "not-a-district",
      coverageStatus: "available",
      demandWave: 99,
      reason: "a custom reviewer note",
      gateVersion: 2,
    })?.props).toEqual({});
  });

  it("every registered event's prop list is an array (registry shape)", () => {
    for (const keys of Object.values(ANALYTICS_EVENTS)) {
      expect(Array.isArray(keys)).toBe(true);
    }
  });
});
