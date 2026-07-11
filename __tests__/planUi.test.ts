import { describe, expect, it } from "vitest";

import { planViewModel, shareCopyForPlan } from "@/components/plan/planPresentation";
import type { PlanState } from "@/lib/plan";

const state: PlanState = {
  plan: {
    id: "6ab5ca40-836b-4970-9477-d1779fdd31ab",
    title: "Thursday, sorted",
    startTime: "2026-07-16T17:30:00.000Z",
    createdAt: "2026-07-11T12:00:00.000Z",
  },
  stops: [
    { venueId: "v-second", venueName: "The Swan", position: 2 },
    { venueId: "v-first", venueName: "The George", position: 1 },
  ],
  crew: [],
};

describe("planViewModel", () => {
  it("renders crawl stops in their explicit order", () => {
    expect(planViewModel(state).stops.map((stop) => stop.venueName)).toEqual([
      "The George",
      "The Swan",
    ]);
  });

  it("keeps the invite copy useful before anyone joins", () => {
    expect(shareCopyForPlan(state)).toBe(
      "Thursday, sorted · 2 stops · Starts 18:30 — see the plan and tap I'm in.",
    );
  });
});
