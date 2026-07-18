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
    expect(sanitizeEvent("plan_created", { count: Number.NaN })?.props).toEqual({});
    expect(sanitizeEvent("plan_created", { count: Infinity })?.props).toEqual({});
  });

  it("accepts only reviewed enum strings plus bounded numbers", () => {
    expect(sanitizeEvent("plan_created", { count: 5 })?.props).toEqual({ count: 5 });
    expect(sanitizeEvent("poster_shared", { surface: "borough" })?.props).toEqual({
      surface: "borough",
    });
    expect(sanitizeEvent("poster_shared", { surface: "someone's private note" })?.props).toEqual({});
    expect(sanitizeEvent("booking_click", { venueId: "person-or-private-id", tier: "direct" })?.props)
      .toEqual({ tier: "direct" });
  });

  it("keeps only bounded performance fields for web vitals", () => {
    expect(sanitizeEvent("web_vital", {
      metric: "INP",
      value: 143,
      rating: "good",
      attribution: "button#private-account-control",
    })?.props).toEqual({ metric: "INP", value: 143, rating: "good" });
  });

  it("keeps the activation and retention funnel free of identity and free text", () => {
    expect(sanitizeEvent("crew_committed", {
      source: "plan-link",
      participants: 3,
      handle: "night_owl",
      note: "meet us by the bar",
    })).toEqual({
      name: "crew_committed",
      props: { source: "plan-link", participants: 3 },
    });

    expect(sanitizeEvent("next_night_committed", {
      windowDays: 18,
      source: "crew-reinvite",
      email: "private@example.com",
    })).toEqual({
      name: "next_night_committed",
      props: { windowDays: 18, source: "crew-reinvite" },
    });
  });

  it.each(["morning", "afternoon", "evening", "night"])(
    "keeps the landing daypart %s",
    (daypart) => {
      expect(sanitizeEvent("discovery_viewed", { surface: "landing", daypart })?.props)
        .toEqual({ surface: "landing", daypart });
    },
  );

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

  it("does not expose streak or alcohol-quantity progression events", () => {
    expect(isKnownEvent("streak_increment")).toBe(false);
    expect(isKnownEvent("streak_view")).toBe(false);
    expect(sanitizeEvent("streak_increment", { days: 4 })).toBeNull();
  });

  describe("metrics funnel events (Wave M)", () => {
    it("accepts a UUID-shaped inviteId for invite_created and invite_redeemed", () => {
      const inviteId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
      expect(sanitizeEvent("invite_created", { inviteId })).toEqual({
        name: "invite_created",
        props: { inviteId },
      });
      expect(sanitizeEvent("invite_redeemed", { inviteId })).toEqual({
        name: "invite_redeemed",
        props: { inviteId },
      });
    });

    it("rejects a non-UUID inviteId (free text can never reach telemetry via this key)", () => {
      expect(sanitizeEvent("invite_created", { inviteId: "not-a-uuid" })?.props).toEqual({});
      expect(sanitizeEvent("invite_created", { inviteId: "jane.doe@example.com" })?.props).toEqual({});
      expect(sanitizeEvent("invite_created", { inviteId: 12345 })?.props).toEqual({});
    });

    it("accepts a bounded numeric dayBucket for activity_pulse", () => {
      expect(sanitizeEvent("activity_pulse", { dayBucket: 20_285 })?.props).toEqual({ dayBucket: 20_285 });
      expect(sanitizeEvent("activity_pulse", { dayBucket: Number.NaN })?.props).toEqual({});
      expect(sanitizeEvent("activity_pulse", { dayBucket: -1 })?.props).toEqual({});
    });

    it("carries no props for the A2HS install funnel events", () => {
      expect(sanitizeEvent("pwa_install_prompt_available", { extra: "x" })).toEqual({
        name: "pwa_install_prompt_available",
        props: {},
      });
      expect(sanitizeEvent("pwa_install_completed")).toEqual({
        name: "pwa_install_completed",
        props: {},
      });
      expect(sanitizeEvent("pwa_standalone_launch")).toEqual({
        name: "pwa_standalone_launch",
        props: {},
      });
    });
  });
});
