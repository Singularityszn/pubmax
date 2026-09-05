import { describe, expect, it } from "vitest";

import { inferNightContext } from "@/lib/nightPlanning";
import { parsePlanGenerationIntake } from "@/lib/planGenerationIntake";
import { cleanCreatePlan } from "@/lib/plan";
import {
  DEFAULT_PLAN_STOP_COUNT,
  MAX_PLAN_STOP_COUNT,
  MIN_PLAN_STOP_COUNT,
  PLAN_STOP_COUNTS,
  PLAN_STOP_COUNT_RANGE_SENTENCE,
  inferPlanStopCount,
  isPlanStopCount,
  normalizePlanStopCount,
  planOutingNoun,
} from "@/lib/planStopCount";
import {
  selectAnchoredGroundedPlanRoute,
  selectGroundedPlanRoute,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
} from "@/lib/planRouteOptimizer";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

function constraints(
  overrides: Partial<GroundedPlanRouteConstraints> = {},
): GroundedPlanRouteConstraints {
  return {
    exactArea: null,
    accessibilityNeeds: [],
    budgetLimitPence: null,
    budgetTier: null,
    groupSize: null,
    transportConstraints: [],
    routeWindow: null,
    now: NOW,
    ...overrides,
  };
}

function candidate(
  venueId: string,
  options: Partial<GroundedPlanRouteCandidate<string>> = {},
): GroundedPlanRouteCandidate<string> {
  return {
    value: venueId,
    venueId,
    venueName: venueId,
    score: 1,
    lat: 51.5,
    lng: -0.1,
    price: { pence: null, source: null, confidenceState: "unknown" },
    promoted: false,
    avoidedByReviewedSignal: false,
    access: {},
    openingSchedule: null,
    ...options,
  };
}

function intake(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    area: null,
    timeWindow: null,
    groupSize: null,
    budget: null,
    accessibilityNeeds: [],
    skipped: ["area", "time-window", "group-size", "budget", "accessibility"],
    ...overrides,
  };
}

describe("the stop-count table", () => {
  it("offers one and two stops, because an outing is often one venue or two", () => {
    expect(PLAN_STOP_COUNTS).toEqual([1, 2, 3, 4, 5, 6]);
    expect(MIN_PLAN_STOP_COUNT).toBe(1);
    expect(MAX_PLAN_STOP_COUNT).toBe(6);
    expect(isPlanStopCount(1)).toBe(true);
    expect(isPlanStopCount(2)).toBe(true);
  });

  it("keeps three as the default, so a night nobody sized still builds the same crawl", () => {
    expect(DEFAULT_PLAN_STOP_COUNT).toBe(3);
    expect(normalizePlanStopCount(undefined)).toBe(3);
    expect(normalizePlanStopCount(0)).toBe(3);
    expect(normalizePlanStopCount(7)).toBe(3);
    expect(normalizePlanStopCount("2")).toBe(3);
  });

  it("derives the range sentence, so a refusal cannot rot apart from the table", () => {
    expect(PLAN_STOP_COUNT_RANGE_SENTENCE).toBe("one to six");
  });

  it("names one pub a meetup and everything else a crawl", () => {
    expect(planOutingNoun(1)).toBe("meetup");
    expect(planOutingNoun(2)).toBe("crawl");
    expect(planOutingNoun(6)).toBe("crawl");
    expect(planOutingNoun(undefined)).toBe("crawl");
  });
});

describe("reading a stop count out of free text", () => {
  it.each([
    ["one pub in Clapham", 1],
    ["2 pubs in Soho", 2],
    ["just two stops tonight", 2],
    ["three venues in Camden", 3],
    ["big crawl in Shoreditch", 6],
  ])("reads %s as %i stops", (query, expected) => {
    expect(inferPlanStopCount(query, NUMBER_WORDS)).toBe(expected);
  });

  it("never reads a GROUP size as a stop count", () => {
    // The captain's own case: "for 2" is two drinkers, not two pubs.
    expect(inferPlanStopCount("quiet in Clapham for 2", NUMBER_WORDS)).toBe(DEFAULT_PLAN_STOP_COUNT);
    expect(inferPlanStopCount("party of two in Soho", NUMBER_WORDS)).toBe(DEFAULT_PLAN_STOP_COUNT);
    const inferred = inferNightContext("quiet in Clapham for 2");
    expect(inferred.context.groupSize).toBe(2);
    expect(inferred.context.stopCount).toBe(DEFAULT_PLAN_STOP_COUNT);
  });

  it("carries one and two through the whole Night Context", () => {
    expect(inferNightContext("one pub in Clapham for 2").context.stopCount).toBe(1);
    expect(inferNightContext("two pubs in Clapham for 4").context.stopCount).toBe(2);
  });
});

describe("the generator respects the count it was given", () => {
  it.each([1, 2, 3])("builds exactly %i grounded stops", (stopCount) => {
    const candidates = Array.from({ length: 5 }, (_, index) => candidate(`venue-${index}`));
    const result = selectGroundedPlanRoute(candidates, constraints({ stopCount } as Partial<GroundedPlanRouteConstraints>));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops).toHaveLength(stopCount);
    expect(new Set(result.stops.map((stop) => stop.venueId)).size).toBe(stopCount);
  });

  it("keeps the accepted pub as the whole route when one stop is asked for", () => {
    const candidates = [candidate("anchor"), candidate("other")];
    const result = selectAnchoredGroundedPlanRoute(
      candidates,
      constraints({ stopCount: 1 } as Partial<GroundedPlanRouteConstraints>),
      "anchor",
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome !== "route") throw new Error("expected a one-stop route outcome");
    expect(result.stops.map((stop) => stop.venueId)).toEqual(["anchor"]);
  });

  it("never invents a venue to fill a stop", () => {
    // One eligible pub cannot answer a two-stop ask, and scarcity is the answer.
    const result = selectGroundedPlanRoute(
      [candidate("only-one")],
      constraints({ stopCount: 2 } as Partial<GroundedPlanRouteConstraints>),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.eligibleCandidateCount).toBe(1);
  });
});

describe("the request boundary admits one and two", () => {
  it.each([1, 2, 3, 4, 5, 6])("accepts intake stopCount %i", (stopCount) => {
    const parsed = parsePlanGenerationIntake(intake({ stopCount }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.handoff.stopCount).toBe(stopCount);
  });

  it.each([0, 7, 2.5])("still refuses intake stopCount %s", (stopCount) => {
    const parsed = parsePlanGenerationIntake(intake({ stopCount }));
    expect(parsed.ok).toBe(false);
  });

  it("creates a one-stop and a two-stop Plan, as it always could server-side", () => {
    const base = {
      title: "Meetup",
      creatorName: "Karan",
      startTime: "2026-07-20T18:00:00.000Z",
    };
    expect(cleanCreatePlan({ ...base, stops: [{ venueId: "a", venueName: "A" }] })?.stops).toHaveLength(1);
    expect(cleanCreatePlan({
      ...base,
      stops: [{ venueId: "a", venueName: "A" }, { venueId: "b", venueName: "B" }],
    })?.stops).toHaveLength(2);
  });
});
