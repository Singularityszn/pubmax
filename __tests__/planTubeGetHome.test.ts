// DEFECT (UX sprint, 15 Oct 2026, production): any plan request with "tube" in
// it failed before one pub was scored. inferNightContext matched /tube/ (also
// inside "YouTube") and set transportConstraints ["tube"], and the optimizer
// refused every route while that list was not empty. "cheap pints in Soho for
// 4, then home by tube" returned "No 3-stop route in Piccadilly & Soho meets
// every must-have need". A way home shapes the ending, not the route.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/planRouteEvidence.server", () => ({
  planPriceEvidenceForVenues: async (venues: Array<{ id: string }>) => new Map(
    venues.map((venue) => [venue.id, { pence: null, source: null, confidenceState: "unknown" as const }]),
  ),
  planOpeningSchedulesForVenues: async (venues: Array<{ id: string }>) => new Map(
    venues.map((venue) => [venue.id, null]),
  ),
  planAccessEvidenceForVenue: () => ({}),
}));

import { inferNightContext, type NightContext } from "@/lib/nightPlanning";
import { planGenerationEvidenceGaps } from "@/lib/planGenerationRanking";
import {
  selectPlanGenerationCandidates,
  type ScoredPlanCandidate,
} from "@/lib/planGenerationSelection.server";
import { routeTransportConstraints } from "@/lib/planGetHome";
import {
  selectAnchoredGroundedPlanRoute,
  selectGroundedPlanRoute,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
} from "@/lib/planRouteOptimizer";

const NOW = new Date("2026-10-15T18:00:00.000Z");
const SPRINT_REQUEST = "cheap pints in Soho for 4, then home by tube";

function routeCandidate(venueId: string, ordinal: number): GroundedPlanRouteCandidate<string> {
  return {
    value: venueId,
    venueId,
    venueName: venueId,
    score: 10 - ordinal,
    lat: 51.513 + ordinal * 0.0005,
    lng: -0.134 + ordinal * 0.0005,
    price: { pence: null, source: null, confidenceState: "unknown" },
    promoted: false,
    avoidedByReviewedSignal: false,
    access: {},
    openingSchedule: null,
  };
}

function constraints(transportConstraints: string[]): GroundedPlanRouteConstraints {
  return {
    exactArea: null,
    accessibilityNeeds: [],
    budgetLimitPence: null,
    budgetTier: null,
    groupSize: 4,
    transportConstraints,
    routeWindow: null,
    now: NOW.getTime(),
  };
}

function scoredCandidate(id: string, ordinal: number): ScoredPlanCandidate {
  return {
    venue: {
      id,
      name: `Venue ${id}`,
      area: "Soho",
      lat: 51.513 + ordinal * 0.0005,
      lng: -0.134 + ordinal * 0.0005,
      cheapestPrice: 4.5,
      amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false },
      nearWater: false,
      hasStory: false,
      canonical: true,
    },
    score: 100 - ordinal,
    signalClaims: [],
  };
}

describe("reading a way home out of a plan request", () => {
  it("reads the sprint request as a tube way home", () => {
    const { context } = inferNightContext(SPRINT_REQUEST, NOW);
    expect(context.nightArea).toBe("piccadilly-soho");
    expect(context.transportConstraints).toEqual(["tube"]);
  });

  it("matches tube as a whole word only, never inside YouTube", () => {
    expect(inferNightContext("pints in Soho after a YouTube shoot", NOW).context.transportConstraints).toEqual([]);
    expect(inferNightContext("tubeless bike, pints in Soho", NOW).context.transportConstraints).toEqual([]);
    expect(inferNightContext("pints in Soho, back on the Tube", NOW).context.transportConstraints).toEqual(["tube"]);
  });

  // A tube way home must never take a stated walk rule out of the record: the
  // ternary used to let "tube" win, so naming the tube UNLOCKED a route for a
  // request that still carried a walk rule the optimizer has no evidence for.
  it("keeps a walk rule beside a tube way home", () => {
    const { context } = inferNightContext(
      "cheap pints in Soho for 4, we want to walk between them and get the tube home",
      NOW,
    );
    expect(context.transportConstraints).toEqual(["tube", "walking"]);
    expect(routeTransportConstraints(context.transportConstraints)).toEqual(["walking"]);
  });

  it("splits a way home from the route rules", () => {
    expect(routeTransportConstraints(["tube", "walking"])).toEqual(["walking"]);
    expect(routeTransportConstraints(["tube"])).toEqual([]);
  });
});

describe("a tube way home never removes a pub from the route", () => {
  const candidates = ["a", "b", "c", "d"].map(routeCandidate);

  it("still builds the route", () => {
    const result = selectGroundedPlanRoute(candidates, constraints(["tube"]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stops).toHaveLength(3);
  });

  it("still builds an anchored route", () => {
    const result = selectAnchoredGroundedPlanRoute(candidates, constraints(["tube"]), "a");
    expect(result).toMatchObject({ ok: true, outcome: "route" });
  });

  it("keeps every other transport word a route rule that fails closed", () => {
    expect(selectGroundedPlanRoute(candidates, constraints(["tube", "walking"])).ok).toBe(false);
  });

  it("still fails the route closed on the walk rule the same sentence states", async () => {
    const { context } = inferNightContext(
      "cheap pints in Soho for 4, we want to walk between them and get the tube home",
      NOW,
    );
    const result = await selectPlanGenerationCandidates(
      [0, 1, 2, 3].map((ordinal) => scoredCandidate(`soho-${ordinal}`, ordinal)),
      context as NightContext,
      null,
      NOW.getTime(),
    );
    expect(result.ok).toBe(false);
  });

  it("returns a route for the exact sprint request", async () => {
    const { context } = inferNightContext(SPRINT_REQUEST, NOW);
    const result = await selectPlanGenerationCandidates(
      [0, 1, 2, 3].map((ordinal) => scoredCandidate(`soho-${ordinal}`, ordinal)),
      context as NightContext,
      null,
      NOW.getTime(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.chosen).toHaveLength(3);
  });
});

describe("a tube way home names no missed need of its own", () => {
  const { context } = inferNightContext(SPRINT_REQUEST, NOW);

  it("names a need only when a route rule really is unevidenced", () => {
    const gaps = (transportConstraints: string[]) => planGenerationEvidenceGaps({
      context: { ...context, transportConstraints } as NightContext,
      accessibilityEnforced: false,
      hasDatedWindow: false,
      allOpeningListed: false,
      hasCompletePriceEvidence: true,
      allZeroProofConfirmed: true,
      hasTonightEvidence: false,
      hasWeatherEvidence: false,
    }).contextEvidenceGaps;
    // A way home costs the plan no confidence: it is checked against the live
    // last service during the night, which the Get home ending already says.
    expect(gaps(["tube"])).toEqual([]);
    // A route rule between stops still has no evidence behind it.
    expect(gaps(["walking"])).toContain("per_venue_transport");
  });
});
