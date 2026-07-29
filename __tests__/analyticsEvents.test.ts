import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENTS,
  isKnownEvent,
  sanitizeEvent,
  WEEKLY_MEANINGFUL_CORE_ACTIONS,
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
    // `route` is required (a known template); an unknown `attribution` key is
    // dropped — only the sanitized `target` selector is allowed through.
    expect(sanitizeEvent("web_vital", {
      metric: "INP",
      value: 143,
      rating: "good",
      route: "/near",
      attribution: "button#private-account-control",
    })?.props).toEqual({ metric: "INP", value: 143, rating: "good", route: "/near" });
  });

  it("keeps the activation and retention funnel free of identity and free text", () => {
    expect(sanitizeEvent("crew_committed", {
      source: "shared-plan",
      participants: 3,
      routeReady: true,
      handle: "night_owl",
      note: "meet us by the bar",
    })).toEqual({
      name: "crew_committed",
      props: { source: "shared-plan", participants: 3, routeReady: true },
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

  describe("PostHog wizard events", () => {
    it.each(["google", "apple", "email"])(
      "keeps only fixed provider enum %s for sign-in initiation",
      (provider) => {
        expect(sanitizeEvent("sign_in_initiated", {
          provider,
          email: "person@example.com",
          callbackUrl: "/auth/callback?code=secret",
        })).toEqual({
          name: "sign_in_initiated",
          props: { provider },
        });
      },
    );

    it.each(["microsoft", "oauth", "private", "person@example.com"])(
      "rejects provider value %s outside the sign-in button enum",
      (provider) => {
        expect(sanitizeEvent("sign_in_initiated", { provider })?.props).toEqual({});
      },
    );

    it.each([
      "user_signed_in",
      "user_signed_out",
      "check_in_created",
      "email_subscribed",
    ])("drops every property from %s", (name) => {
      expect(sanitizeEvent(name, {
        userId: "supabase-user-id",
        handle: "private_handle",
        email: "person@example.com",
        areaSlug: "exact-place",
      })).toEqual({ name, props: {} });
    });
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

  describe("loop metrics (Wave 0.5)", () => {
    it("registers every requested loop outcome with privacy-minimised props", () => {
      expect(sanitizeEvent("plan_generated", {
        stops: 3,
        grounded: true,
        query: "quiet near my home",
        coordinates: "51.5,-0.1",
      })).toEqual({ name: "plan_generated", props: { stops: 3, grounded: true } });
      expect(sanitizeEvent("plan_accepted", {
        stops: 3,
        grounded: true,
        anchored: true,
        routeReady: true,
        source: "near",
        planId: "private-plan",
      })).toEqual({
        name: "plan_accepted",
        props: { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" },
      });
      expect(sanitizeEvent("plan_saved", { stops: 3, grounded: false, title: "Friday with Jamie" }))
        .toEqual({ name: "plan_saved", props: { stops: 3, grounded: false } });
      expect(sanitizeEvent("claim_started", { source: "auth", handle: "private_handle" }))
        .toEqual({ name: "claim_started", props: { source: "auth" } });
      expect(sanitizeEvent("claim_completed", { source: "auth", email: "private@example.com" }))
        .toEqual({ name: "claim_completed", props: { source: "auth" } });
      expect(sanitizeEvent("plan_completed", { ending: "food", finalVenueId: "private-venue" }))
        .toEqual({ name: "plan_completed", props: { ending: "food" } });
      expect(sanitizeEvent("memory_reviewed", { source: "inline_recap", caption: "private words" }))
        .toEqual({ name: "memory_reviewed", props: { source: "inline_recap" } });
      expect(sanitizeEvent("memory_reviewed", { source: "full_recap" }))
        .toEqual({ name: "memory_reviewed", props: { source: "full_recap" } });
      expect(sanitizeEvent("story_published", {
        visibility: "unlisted",
        contributors: 3,
        moments: 4,
        storyId: "private-story",
      })).toEqual({
        name: "story_published",
        props: { visibility: "unlisted", contributors: 3, moments: 4 },
      });
    });

    it("enforces exact loop prop types and ranges", () => {
      expect(sanitizeEvent("plan_generated", { stops: 51, grounded: 1 })?.props).toEqual({});
      expect(sanitizeEvent("plan_accepted", {
        stops: 0,
        grounded: "true",
        anchored: true,
        routeReady: true,
        source: "near",
      })).toBeNull();
      expect(sanitizeEvent("plan_saved", { stops: 3, grounded: true })?.props)
        .toEqual({ stops: 3, grounded: true });
      expect(sanitizeEvent("claim_started", { source: "you" })?.props).toEqual({});
      expect(sanitizeEvent("plan_completed", { ending: true })?.props).toEqual({});
      expect(sanitizeEvent("memory_reviewed", { source: 51 })?.props).toEqual({});
      expect(sanitizeEvent("story_published", {
        visibility: "private",
        contributors: 3.5,
        moments: 101,
      })?.props).toEqual({});
    });

    it("defines Weekly Meaningful Pubmaxxers from explicit core actions only", () => {
      expect(WEEKLY_MEANINGFUL_CORE_ACTIONS).toEqual([
        "plan_accepted",
        "plan_saved",
        "plan_completed",
        "memory_reviewed",
        "story_published",
      ]);
      for (const action of WEEKLY_MEANINGFUL_CORE_ACTIONS) {
        expect(sanitizeEvent("meaningful_core_action", { action, note: "never sent" }))
          .toEqual({ name: "meaningful_core_action", props: { action } });
      }
      expect(sanitizeEvent("meaningful_core_action", { action: "plan_generated" })).toBeNull();
      expect(sanitizeEvent("meaningful_core_action", { action: "claim_completed" })).toBeNull();
      expect(sanitizeEvent("meaningful_core_action", { action: "arrived" })).toBeNull();
      expect(sanitizeEvent("meaningful_core_action")).toBeNull();
    });
  });
});

describe("community-price funnel events", () => {
  it("registers submission and required-identity funnel steps", () => {
    expect(isKnownEvent("price_submit_viewed")).toBe(true);
    expect(isKnownEvent("price_submitted")).toBe(true);
    expect(isKnownEvent("price_submit_failed")).toBe(true);
    expect(isKnownEvent("contribution_gate")).toBe(true);
  });

  it("keeps the drink category and the failure reason", () => {
    expect(sanitizeEvent("price_submit_viewed", { category: "beer" })).toEqual({
      name: "price_submit_viewed",
      props: { category: "beer" },
    });
    expect(sanitizeEvent("price_submitted", { category: "cocktail" })).toEqual({
      name: "price_submitted",
      props: { category: "cocktail" },
    });
    expect(
      sanitizeEvent("price_submit_failed", { category: "wine", reason: "rejected" }),
    ).toEqual({
      name: "price_submit_failed",
      props: { category: "wine", reason: "rejected" },
    });
  });

  it("never carries the venue, the price, or the error sentence", () => {
    const ev = sanitizeEvent("price_submitted", {
      category: "beer",
      venueId: "the-lamb",
      venueName: "The Lamb",
      priceGbp: 4.2,
    });
    expect(ev).toEqual({ name: "price_submitted", props: { category: "beer" } });
  });

  it("fails closed on an off-taxonomy category or an unknown reason", () => {
    expect(sanitizeEvent("price_submitted", { category: "absinthe" })).toBeNull();
    expect(sanitizeEvent("price_submitted", {})).toBeNull();
    expect(
      sanitizeEvent("price_submit_failed", { category: "beer", reason: "server_said_no" }),
    ).toBeNull();
  });

  it("does not leak its vocabulary into the pal-memory category key", () => {
    // Same prop NAME, a different closed set - the price check must be scoped
    // to the funnel events, not to the key.
    expect(
      sanitizeEvent("pub_pal_memory_changed", { action: "create", category: "preference" }),
    ).toEqual({
      name: "pub_pal_memory_changed",
      props: { action: "create", category: "preference" },
    });
  });

  it("keeps only closed, identity-free contribution gate states", () => {
    for (const step of ["sign_in_required", "onboarding_required"]) {
      expect(sanitizeEvent("contribution_gate", { step })).toEqual({
        name: "contribution_gate",
        props: { step },
      });
    }
    for (const step of [
      "age_assessment_required",
      "age_assessment_passed",
      "age_restricted",
    ]) {
      expect(sanitizeEvent("contribution_gate", { step })).toBeNull();
    }
    expect(sanitizeEvent("contribution_gate", { step: "user@example.com" })).toBeNull();
    expect(sanitizeEvent("contribution_gate", {})).toBeNull();
  });
});
