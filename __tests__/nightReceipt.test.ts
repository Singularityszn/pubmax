import { describe, expect, it } from "vitest";

import type { PlanMemberRole, PlanState } from "@/lib/plan";
import { projectNightReceipt } from "@/lib/nightReceipt";

const MATE_NAME = "Priya the Pal";
const HOST_NAME = "Sam Host";

function completedState(overrides: Partial<PlanState> = {}): PlanState {
  return {
    plan: {
      id: "plan-receipt-1",
      title: "Borough birthday",
      startTime: "2026-11-14T19:00:00.000Z",
      createdAt: "2026-11-10T12:00:00.000Z",
      status: "completed",
    },
    stops: [
      {
        venueId: "venue-b",
        venueName: "The Second Pub",
        position: 1,
        selectedDrinkPriceEvidence: {
          category: "wine",
          pence: 650,
          serving: null,
          source: "community",
          reportedAt: "2026-11-03T18:00:00.000Z",
        },
      },
      { venueId: "venue-a", venueName: "The First Pub", position: 0 },
    ],
    crew: [
      { id: "m-host", name: HOST_NAME, status: "here", joinedAt: "2026-11-10T12:00:00.000Z", updatedAt: "2026-11-14T19:05:00.000Z" },
      { id: "m-mate", name: MATE_NAME, status: "here", joinedAt: "2026-11-11T12:00:00.000Z", updatedAt: "2026-11-14T19:06:00.000Z" },
    ],
    actions: [
      { id: "a-1", type: "arrived", stopPosition: 0, ending: null, createdAt: "2026-11-14T19:05:00.000Z", venueId: "venue-a" },
      { id: "a-2", type: "arrived", stopPosition: 1, ending: null, createdAt: "2026-11-14T20:15:00.000Z", venueId: "venue-b" },
    ],
    ending: "food",
    ...overrides,
  };
}

function project(state: PlanState | null, role: PlanMemberRole | null = "host") {
  return projectNightReceipt({ state, role });
}

describe("the private Night Receipt projection", () => {
  it("shows nothing to a reader who only has the public preview", () => {
    expect(project(null)).toEqual({ kind: "none" });
  });

  it.each([["guest"], [null]] as const)("shows nothing to a %s reader of a completed Plan", (role) => {
    expect(project(completedState(), role)).toEqual({ kind: "none" });
  });

  it.each(["draft", "ready", "active", "ending", "abandoned"] as const)(
    "shows nothing while the Plan is %s",
    (status) => {
      const state = completedState();
      expect(project({ ...state, plan: { ...state.plan, status } })).toEqual({ kind: "none" });
    },
  );

  it("shows nothing for a legacy Plan with no recorded status", () => {
    const state = completedState();
    const { status: _status, ...plan } = state.plan;
    expect(project({ ...state, plan })).toEqual({ kind: "none" });
  });

  it("lists the owner's completed route in order with its saved price evidence", () => {
    const projection = project(completedState());
    expect(projection.kind).toBe("receipt");
    if (projection.kind !== "receipt") return;
    expect(projection.receipt).toEqual({
      title: "Borough birthday",
      plannedFor: "2026-11-14T19:00:00.000Z",
      stops: [
        { position: 0, venueName: "The First Pub", price: null },
        {
          position: 1,
          venueName: "The Second Pub",
          price: { drink: "Wine", pence: 650, source: "community", reportedAt: "2026-11-03T18:00:00.000Z" },
        },
      ],
      ending: "food",
      paid: "not_recorded",
    });
  });

  it("never names the crew or claims who arrived where", () => {
    const projection = project(completedState());
    const text = JSON.stringify(projection);
    expect(text).not.toContain(MATE_NAME);
    expect(text).not.toContain(HOST_NAME);
    expect(text).not.toMatch(/arriv|attend|visited|checked/i);
  });

  it("keeps what was paid unknown even when every stop has a price on record", () => {
    const state = completedState();
    const priced = {
      ...state,
      stops: state.stops.map((stop) => ({
        ...stop,
        selectedDrinkPriceEvidence: {
          category: "wine" as const,
          pence: 500,
          serving: null,
          source: "community" as const,
          reportedAt: "2026-11-03T18:00:00.000Z",
        },
      })),
    };
    const projection = project(priced);
    if (projection.kind !== "receipt") throw new Error("expected a receipt");
    expect(projection.receipt.paid).toBe("not_recorded");
    expect(projection.receipt).not.toHaveProperty("totalPence");
    expect(projection.receipt).not.toHaveProperty("totalGbp");
  });

  it.each([
    ["a zero figure", { pence: 0 }],
    ["a beer figure with no serving", { category: "beer" }],
    ["an unreadable report date", { reportedAt: "last week" }],
    ["an unknown source", { source: "listing" }],
  ])("marks %s as no price rather than zero", (_label, change) => {
    const state = completedState();
    const broken = {
      ...state,
      stops: [{
        venueId: "venue-b",
        venueName: "The Second Pub",
        position: 0,
        selectedDrinkPriceEvidence: {
          category: "wine",
          pence: 650,
          serving: null,
          source: "community",
          reportedAt: "2026-11-03T18:00:00.000Z",
          ...change,
        },
      }],
    } as unknown as PlanState;
    const projection = project(broken);
    if (projection.kind !== "receipt") throw new Error("expected a receipt");
    expect(projection.receipt.stops).toEqual([{ position: 0, venueName: "The Second Pub", price: null }]);
  });

  it("leaves an unreadable start time and an unrecorded ending unknown", () => {
    const state = completedState();
    const projection = project({ ...state, plan: { ...state.plan, startTime: "soon" }, ending: null });
    if (projection.kind !== "receipt") throw new Error("expected a receipt");
    expect(projection.receipt.plannedFor).toBeNull();
    expect(projection.receipt.ending).toBeNull();
  });
});
