// A crawl takes one branch of a chain, not three.
//
// "Cheap pints in Shoreditch for 4" came back as The Masque Haunt, Hamilton
// Hall and a third pub: two Wetherspoon branches out of three stops, because a
// cheap-pint ranking puts every branch of the cheapest chain at the top. The
// optimizer now prefers one stop per known operator, keeps a Spoons crawl for
// the person who asks for one, and never turns a route into a refusal to get
// variety.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  selectAnchoredGroundedPlanRoute,
  selectGroundedPlanRoute,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
} from "@/lib/planRouteOptimizer";
import {
  firstCandidatesPerOperator,
  type ScoredPlanCandidate,
} from "@/lib/planGenerationSelection.server";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

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
    oneStopPerOperator: true,
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
    operator: null,
    ...options,
  };
}

// Three cheap Spoons outrank two independents, as a cheap-pint score does.
const SHOREDITCH = [
  candidate("masque-haunt", { score: 10, operator: "wetherspoon" }),
  candidate("hamilton-hall", { score: 9, operator: "wetherspoon" }),
  candidate("goodmans-field", { score: 8, operator: "wetherspoon" }),
  candidate("the-owl", { score: 5 }),
  candidate("the-crown", { score: 4 }),
];

function stopIds(result: ReturnType<typeof selectGroundedPlanRoute<string>>): string[] {
  if (!result.ok) throw new Error("expected a route");
  return result.stops.map((stop) => stop.venueId).sort();
}

describe("one stop per operator", () => {
  it("takes the best branch of a chain and fills the rest with other pubs", () => {
    expect(stopIds(selectGroundedPlanRoute(SHOREDITCH, constraints()))).toEqual(
      ["masque-haunt", "the-crown", "the-owl"],
    );
  });

  it("keeps a Spoons crawl for the person who asks for one", () => {
    expect(
      stopIds(selectGroundedPlanRoute(SHOREDITCH, constraints({ oneStopPerOperator: false }))),
    ).toEqual(["goodmans-field", "hamilton-hall", "masque-haunt"]);
  });

  it("falls back to repeating a chain rather than refusing the route", () => {
    const onlySpoons = SHOREDITCH.slice(0, 3);
    expect(stopIds(selectGroundedPlanRoute(onlySpoons, constraints()))).toEqual(
      ["goodmans-field", "hamilton-hall", "masque-haunt"],
    );
  });

  it("never offers a second branch as a stop's alternative", () => {
    const result = selectGroundedPlanRoute([...SHOREDITCH, candidate("the-bell", { score: 3 })], constraints());
    if (!result.ok) throw new Error("expected a route");
    const spoonsStop = result.stops.findIndex((stop) => stop.operator === "wetherspoon");
    for (const [position, alternatives] of result.alternatives.entries()) {
      if (position === spoonsStop) continue;
      expect(alternatives.map((stop) => stop.operator)).not.toContain("wetherspoon");
    }
  });

  it("finds the variety even when one chain fills the top of a long list", () => {
    const manySpoons = Array.from({ length: 16 }, (_, index) =>
      candidate(`spoons-${String(index).padStart(2, "0")}`, { score: 20 - index, operator: "wetherspoon" }));
    const result = selectGroundedPlanRoute(
      [...manySpoons, candidate("the-owl", { score: 2 }), candidate("the-crown", { score: 1 })],
      constraints(),
    );
    expect(stopIds(result)).toEqual(["spoons-00", "the-crown", "the-owl"]);
  });

  it("counts the anchor's chain, so its companions come from elsewhere", () => {
    const result = selectAnchoredGroundedPlanRoute(SHOREDITCH, constraints(), "hamilton-hall");
    if (!result.ok || result.outcome !== "route") throw new Error("expected a route");
    expect(result.stops[0]?.venueId).toBe("hamilton-hall");
    expect(result.stops.map((stop) => stop.venueId).slice(1).sort()).toEqual(["the-crown", "the-owl"]);
  });
});

describe("the ungrounded path takes one branch first too", () => {
  function scored(id: string, operator: string | null): ScoredPlanCandidate {
    return { venue: { id } as ScoredPlanCandidate["venue"], score: 0, signalClaims: [], operator };
  }
  const ranked = [
    scored("masque-haunt", "wetherspoon"),
    scored("hamilton-hall", "wetherspoon"),
    scored("the-owl", null),
    scored("the-crown", null),
  ];

  it("skips a second branch while other pubs remain", () => {
    expect(firstCandidatesPerOperator(ranked, 3).map((c) => c.venue.id)).toEqual(
      ["masque-haunt", "the-owl", "the-crown"],
    );
  });

  it("fills with a repeat, in score order, when there are not enough other pubs", () => {
    expect(firstCandidatesPerOperator(ranked, 4).map((c) => c.venue.id)).toEqual(
      ["masque-haunt", "hamilton-hall", "the-owl", "the-crown"],
    );
  });
});
