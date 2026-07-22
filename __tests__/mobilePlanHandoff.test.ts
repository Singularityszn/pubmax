import { describe, expect, it } from "vitest";

import { mobilePlanHandoffSummary } from "@/lib/mobilePlanHandoff";
import type { CrewMemberDTO } from "@/lib/crew";
import type { PlanActionDTO, PlanState, PlanStopDTO } from "@/lib/plan";

function stop(position: number, venueName = `Pub ${position}`): PlanStopDTO {
  return { venueId: `venue-${position}`, venueName, position };
}

function crew(name: string): CrewMemberDTO {
  return {
    id: `member-${name}`,
    name,
    status: "in",
    joinedAt: "2026-07-22T18:00:00.000Z",
    updatedAt: "2026-07-22T18:00:00.000Z",
  };
}

function action(type: PlanActionDTO["type"], stopPosition: number): PlanActionDTO {
  return {
    id: `${type}-${stopPosition}`,
    type,
    stopPosition,
    ending: null,
    createdAt: "2026-07-22T20:00:00.000Z",
  };
}

function plan(overrides: Partial<PlanState> = {}): PlanState {
  return {
    plan: {
      id: "plan-handoff",
      title: "Soho v1 night",
      startTime: "2026-07-22T19:30:00.000Z",
      createdAt: "2026-07-22T18:00:00.000Z",
      ...overrides.plan,
    },
    stops: overrides.stops ?? [stop(0, "Blue Posts"), stop(1, "French House"), stop(2, "Ship")],
    crew: overrides.crew ?? [],
    actions: overrides.actions,
    ending: overrides.ending,
    context: overrides.context,
  };
}

describe("mobilePlanHandoffSummary", () => {
  it("keeps a new shared plan focused on tonight's first route action", () => {
    const summary = mobilePlanHandoffSummary(plan({ crew: [crew("Maya"), crew("Karan")] }));

    expect(summary).toMatchObject({
      startLabel: "20:30",
      stopCount: 3,
      crewCount: 2,
      progressLabel: "3 pubs from 20:30",
      statusLabel: "Ready for tonight",
      primaryLabel: "Catch up at stop 1",
      targetStop: { venueName: "Blue Posts", stopNumber: 1 },
    });
  });

  it("surfaces live crawl progress for late arrivals", () => {
    const summary = mobilePlanHandoffSummary(plan({
      actions: [action("arrived", 0), action("skipped", 1)],
    }));

    expect(summary).toMatchObject({
      progressLabel: "2/3 stops checked in",
      statusLabel: "Crew is moving",
      primaryLabel: "Catch up at stop 3",
      targetStop: { venueName: "Ship", stopNumber: 3 },
    });
  });

  it("does not make a completed plan read like an active night", () => {
    const summary = mobilePlanHandoffSummary(plan({
      plan: {
        id: "plan-handoff",
        title: "Soho v1 night",
        startTime: "2026-07-22T19:30:00.000Z",
        createdAt: "2026-07-22T18:00:00.000Z",
        status: "completed",
      },
      ending: "get_home",
    }));

    expect(summary.statusLabel).toBe("Night wrapped");
  });
});
