import { describe, expect, it } from "vitest";

import type { PlanState } from "@/lib/plan";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import {
  buildPlanPrivacyPreview,
  memberProjection,
  planRouteReady,
} from "@/lib/planPrivacy";

const AREA = NIGHT_AREAS[0];

function planState(overrides: Partial<PlanState> = {}): PlanState {
  return {
    plan: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Dave's stag do — SECRET ROUTE",
      startTime: "2026-07-24T19:00:00.000Z",
      createdAt: "2026-07-24T12:00:00.000Z",
      status: "ready",
    },
    stops: [
      { venueId: "venue-the-dove", venueName: "The Dove", position: 0 },
      { venueId: "venue-the-anchor", venueName: "The Anchor", position: 1 },
      { venueId: "venue-the-crown", venueName: "The Crown", position: 2 },
    ],
    crew: [
      { id: "c1", name: "Dave" },
      { id: "c2", name: "Priya" },
    ] as PlanState["crew"],
    context: { nightArea: AREA.slug, accessibility: ["step-free", "quiet space"] } as PlanState["context"],
    actions: [],
    ending: null,
    ...overrides,
  };
}

describe("buildPlanPrivacyPreview", () => {
  it("exposes exactly the safe signals and names no Venue", () => {
    const preview = buildPlanPrivacyPreview(planState());
    expect(preview).toEqual({
      visibility: "preview",
      hostDisplayName: "Dave",
      areaName: AREA.name,
      startLabel: expect.any(String),
      stopCount: 3,
      vibeLabel: null,
      accessibilitySummary: "step-free, quiet space",
      routeReady: true,
    });
  });

  it("carries NONE of the plan's venue ids, names, or user title (serialization guard)", () => {
    const state = planState();
    const raw = JSON.stringify(buildPlanPrivacyPreview(state));
    for (const stop of state.stops) {
      expect(raw).not.toContain(stop.venueId);
      expect(raw).not.toContain(stop.venueName);
    }
    expect(raw).not.toContain(state.plan.title);
    // Crew beyond the host is never named.
    expect(raw).not.toContain("Priya");
  });

  it("falls back to a generic host label and null area when unknown", () => {
    const preview = buildPlanPrivacyPreview(
      planState({ crew: [] as PlanState["crew"], context: null }),
    );
    expect(preview.hostDisplayName).toBe("Your host");
    expect(preview.areaName).toBeNull();
    expect(preview.accessibilitySummary).toBeNull();
  });

  it("counts stops without naming them, for 1-stop and 3-stop plans", () => {
    expect(buildPlanPrivacyPreview(planState({ stops: [
      { venueId: "venue-solo", venueName: "The Only One", position: 0 },
    ] })).stopCount).toBe(1);
    expect(buildPlanPrivacyPreview(planState()).stopCount).toBe(3);
  });
});

describe("planRouteReady", () => {
  it("is true for a non-draft, non-abandoned status", () => {
    for (const status of ["ready", "active", "ending", "completed"] as const) {
      expect(planRouteReady(planState({ plan: { ...planState().plan, status } }))).toBe(true);
    }
  });
  it("is false for draft, abandoned, or legacy (no status)", () => {
    expect(planRouteReady(planState({ plan: { ...planState().plan, status: "draft" } }))).toBe(false);
    expect(planRouteReady(planState({ plan: { ...planState().plan, status: "abandoned" } }))).toBe(false);
    expect(planRouteReady(planState({ plan: { ...planState().plan, status: undefined } }))).toBe(false);
  });
});

describe("memberProjection", () => {
  it("returns the full state under a member discriminator", () => {
    const state = planState();
    expect(memberProjection(state)).toEqual({ visibility: "member", state });
  });
});
