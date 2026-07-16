import { describe, expect, it } from "vitest";

import {
  completePlanPayload,
  confirmedEndingForPlan,
  recommendedEndingForPlan,
  routeRevisionFromPlan,
} from "@/components/night/NightModeCard";
import type { PlanState } from "@/lib/plan";

function plan(overrides: Partial<NonNullable<PlanState["context"]>> = {}): PlanState {
  return {
    plan: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Tonight",
      startTime: "2026-07-13T19:00:00.000Z",
      createdAt: "2026-07-13T12:00:00.000Z",
      routeRevision: 1,
      status: "active",
    },
    stops: [],
    crew: [],
    context: {
      nightArea: "clapham",
      daypart: "evening",
      partyType: "friends",
      groupSize: 4,
      budget: "standard",
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
      ...overrides,
      budgetLimitPence: overrides.budgetLimitPence ?? null,
      zeroProof: overrides.zeroProof ?? false,
    },
  };
}

describe("recommendedEndingForPlan", () => {
  it("recommends food only when the plan asked for food and reviewed options exist", () => {
    expect(recommendedEndingForPlan(plan({ foodNeeds: ["kebab"] }), 2)).toBe("food");
    expect(recommendedEndingForPlan(plan({ foodNeeds: ["kebab"] }), 0)).toBe("get_home");
  });

  it("prioritises explicit get-home intent over generic evening defaults", () => {
    expect(recommendedEndingForPlan(plan({ daypart: "get_home", foodNeeds: [] }), 2)).toBe("get_home");
  });

  it("uses get-home as the safe default when there is no stronger signal", () => {
    expect(recommendedEndingForPlan(plan(), 2)).toBe("get_home");
    expect(recommendedEndingForPlan(null, 2)).toBe("get_home");
  });
});

describe("confirmedEndingForPlan", () => {
  it("renders no ending result until an ending is confirmed", () => {
    expect(confirmedEndingForPlan(plan(), null)).toBeNull();
  });

  it("prefers the persisted plan ending over local fallback state", () => {
    expect(confirmedEndingForPlan({ ...plan(), ending: "get_home" }, "food")).toBe("get_home");
  });

  it("does not render a local ending before the canonical completion response", () => {
    expect(confirmedEndingForPlan(plan(), "food")).toBeNull();
  });
});

describe("canonical route revision completion", () => {
  it("reads the active revision and sends the current canonical pub as terminal", () => {
    const current = { ...plan(), routeRevision: 7 } as PlanState & { routeRevision: number };
    expect(routeRevisionFromPlan(current)).toBe(7);
    expect(completePlanPayload("food", "canonical-current-pub", 7)).toEqual({
      ending: "food",
      terminalVenueId: "canonical-current-pub",
      expectedRouteRevision: 7,
    });
  });
});
