import { describe, expect, it } from "vitest";

import { proposalPreservesNight, slidingDoorsOptions } from "@/lib/slidingDoors";
import type { PlanState } from "@/lib/plan";

const stops = ["a", "b", "c"].map((id, position) => ({ venueId: id, venueName: id.toUpperCase(), position }));
const state: PlanState = {
  plan: { id: "plan-one", title: "Friday", startTime: "2026-11-01T18:00:00.000Z", createdAt: "2026-10-31T12:00:00.000Z", routeRevision: 3, anchorVenueId: "a", anchorSource: "near" },
  stops,
  crew: [],
};

describe("Sliding Doors route comparison", () => {
  it("compares a generated route without changing the saved route", () => {
    const before = structuredClone(state);
    const generated = {
      outcome: "route", groundingProof: "signed-proof", operationKey: "operation-one",
      stops: [stops[0], stops[1], { venueId: "d", venueName: "D", position: 2 }],
    };
    const options = slidingDoorsOptions(state, [{ kind: "plot-twist", body: generated }]);
    expect(options.map((option) => option.kind)).toEqual(["original", "plot-twist"]);
    expect(options[1]?.stops.map((stop) => stop.venueId)).toEqual(["a", "b", "d"]);
    expect(state).toEqual(before);
  });

  it("keeps the accepted pub and every actioned stop in place", () => {
    const active = { ...state, actions: [{ id: "arrival", type: "arrived" as const, stopPosition: 1, ending: null, createdAt: "2026-10-31T19:00:00.000Z" }] };
    expect(proposalPreservesNight(active, [stops[0]!, { ...stops[2]!, position: 1 }, { ...stops[1]!, position: 2 }])).toBe(false);
    expect(proposalPreservesNight(active, [stops[0]!, stops[1]!, { venueId: "d", venueName: "D", position: 2 }])).toBe(true);
    expect(proposalPreservesNight(state, [{ ...stops[1]!, position: 0 }, { ...stops[0]!, position: 1 }, stops[2]!])).toBe(false);
  });

  it("rejects unproved, repeated and unsafe generated choices", () => {
    const body = { outcome: "route", groundingProof: "proof", operationKey: "operation-one", stops };
    const options = slidingDoorsOptions(state, [
      { kind: "plot-twist", body },
      { kind: "plot-twist", body: { ...body, stops: [stops[1], stops[0], stops[2]] } },
      { kind: "plot-twist", body: { ...body, groundingProof: null, stops: [stops[0], stops[1], { venueId: "d", venueName: "D" }] } },
    ]);
    expect(options).toHaveLength(1);
  });

  it("calls a route shorter only when the same distance basis shows a shorter walk", () => {
    const points = new Map<string, readonly [number, number]>([
      ["a", [-0.1, 51.5]], ["b", [-0.1, 51.51]], ["c", [-0.1, 51.52]], ["d", [-0.1, 51.505]],
    ]);
    const body = { outcome: "route", groundingProof: "proof", operationKey: "operation-one", stops: [stops[0], { venueId: "d", venueName: "D" }, stops[1]] };
    expect(slidingDoorsOptions(state, [{ kind: "shorter-walk", body }], points).map((option) => option.kind)).toEqual(["original", "shorter-walk"]);
    expect(slidingDoorsOptions(state, [{ kind: "shorter-walk", body }])).toHaveLength(1);
  });
});
