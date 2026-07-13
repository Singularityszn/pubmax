import { describe, expect, it } from "vitest";

import { confirmedEndingForPlan, recommendedEndingForPlan } from "@/components/night/NightModeCard";
import type { PlanState } from "@/lib/plan";

function plan(overrides: Partial<NonNullable<PlanState["context"]>> = {}): PlanState {
  return {
    plan: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Tonight",
      startTime: "2026-07-13T19:00:00.000Z",
      createdAt: "2026-07-13T12:00:00.000Z",
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

  it("allows the success-only local fallback while refreshed plan state catches up", () => {
    expect(confirmedEndingForPlan(plan(), "food")).toBe("food");
  });
});
