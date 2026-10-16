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
import { buildPlanEndingRecommendations } from "@/lib/planEndings";
import { planGenerationEvidenceGaps } from "@/lib/planGenerationRanking";
import {
  selectPlanGenerationCandidates,
  type ScoredPlanCandidate,
} from "@/lib/planGenerationSelection.server";
import { getHomeTransport, routeTransportConstraints } from "@/lib/planGetHome";
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

  it("splits a way home from the route rules", () => {
    expect(getHomeTransport(["tube", "walking"])).toEqual(["tube"]);
    expect(routeTransportConstraints(["tube", "walking"])).toEqual(["walking"]);
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

describe("a tube way home shapes the ending and names what is unchecked", () => {
  const { context } = inferNightContext(SPRINT_REQUEST, NOW);

  it("names the last service as unchecked, not per-venue transport", () => {
    const { contextEvidenceGaps } = planGenerationEvidenceGaps({
      context,
      accessibilityEnforced: false,
      hasDatedWindow: false,
      allOpeningListed: false,
      hasCompletePriceEvidence: true,
      allZeroProofConfirmed: true,
      hasTonightEvidence: false,
      hasWeatherEvidence: false,
    });
    expect(contextEvidenceGaps).toContain("last_service");
    expect(contextEvidenceGaps).not.toContain("per_venue_transport");
  });

  it("asks for the live last-service check on the Get home ending", () => {
    const endings = buildPlanEndingRecommendations({
      daypart: "evening",
      foodRequested: false,
      getHomeRequested: true,
      transportAnchor: "Tottenham Court Road",
      lateFood: [],
      extensions: [],
    });
    const getHome = endings.find((ending) => ending.kind === "get_home");
    expect(getHome?.preselected).toBe(true);
    expect(getHome?.reason).toContain("check the live last-service signal");
  });
});
