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
  it("reads the sprint request as a tube way home, so no route rule survives it", () => {
    const { context } = inferNightContext(SPRINT_REQUEST, NOW);
    expect(context.nightArea).toBe("piccadilly-soho");
    expect(context.transportConstraints).toEqual([]);
  });

  it("matches tube as a whole word only, never inside YouTube", () => {
    expect(inferNightContext("pints in Soho after a YouTube shoot", NOW).context.transportConstraints).toEqual([]);
    expect(inferNightContext("tubeless bike, pints in Soho", NOW).context.transportConstraints).toEqual([]);
  });

  // ONLY A WAY HOME IS DROPPED. Reading every "tube" as a way home turned a
  // stated route rule into silence: "near a tube station" took the legacy
  // candidate slice with no tube-proximity filtering, and the answer named no
  // missed need either.
  it("keeps a tube that is not a way home as a route rule", () => {
    for (const query of [
      "cheap pints near a tube station in Soho for 4",
      "step-free tube access, pints in Soho",
      "a pub by the tube in Soho",
    ]) {
      expect(inferNightContext(query, NOW).context.transportConstraints, query).toEqual(["tube"]);
    }
  });

  it("reads a way home in either order, and close variants of it", () => {
    for (const query of [
      "cheap pints in Soho for 4, then home by tube",
      "pints in Soho, we will get the tube home",
      "pints in Soho then take the tube back home",
      "pints in Soho, home on the last tube",
    ]) {
      expect(inferNightContext(query, NOW).context.transportConstraints, query).toEqual([]);
    }
  });

  // A way home is taken out of the request and only then is the tube asked
  // about, so one way-home phrase can never silence a separate tube rule in
  // the same sentence (review, PR #2134), and a tube that is not the ride home
  // is never read as one because "home" is near it.
  it("keeps a tube route rule that sits beside a tube way home", () => {
    for (const query of [
      "pubs near a tube, then home by tube",
      "home by tube, but pubs near a tube station in Soho",
      "pints near a tube station in Soho, then get the tube home",
      "near a tube, then home by bus",
    ]) {
      expect(inferNightContext(query, NOW).context.transportConstraints, query).toEqual(["tube"]);
    }
  });

  // A tube way home must never take a stated walk rule out of the record: the
  // ternary used to let "tube" win, so naming the tube UNLOCKED a route for a
  // request that still carried a walk rule the optimizer has no evidence for.
  it("keeps a walk rule beside a tube way home", () => {
    const { context } = inferNightContext(
      "cheap pints in Soho for 4, we want to walk between them and get the tube home",
      NOW,
    );
    expect(context.transportConstraints).toEqual(["walking"]);
  });
});

describe("a tube way home never removes a pub from the route", () => {
  const candidates = ["a", "b", "c", "d"].map(routeCandidate);

  it("still builds the route", () => {
    const { context } = inferNightContext(SPRINT_REQUEST, NOW);
    const result = selectGroundedPlanRoute(candidates, constraints(context.transportConstraints));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stops).toHaveLength(3);
  });

  it("still builds an anchored route", () => {
    const { context } = inferNightContext(SPRINT_REQUEST, NOW);
    const result = selectAnchoredGroundedPlanRoute(candidates, constraints(context.transportConstraints), "a");
    expect(result).toMatchObject({ ok: true, outcome: "route" });
  });

  it("keeps every transport word that IS a route rule failing closed", () => {
    expect(selectGroundedPlanRoute(candidates, constraints(["tube"])).ok).toBe(false);
    expect(selectGroundedPlanRoute(candidates, constraints(["walking"])).ok).toBe(false);
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

  it("still fails the route closed on a tube that is a route rule", async () => {
    const { context } = inferNightContext("cheap pints near a tube station in Soho for 4", NOW);
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

describe("the need a plan missed is still named", () => {
  function gapsFor(query: string): string[] {
    const { context } = inferNightContext(query, NOW);
    return planGenerationEvidenceGaps({
      context: context as NightContext,
      accessibilityEnforced: false,
      hasDatedWindow: false,
      allOpeningListed: false,
      hasCompletePriceEvidence: true,
      allZeroProofConfirmed: true,
      hasTonightEvidence: false,
      hasWeatherEvidence: false,
    }).contextEvidenceGaps;
  }

  it("costs a way home no confidence, because the route honoured every rule", () => {
    expect(gapsFor(SPRINT_REQUEST)).toEqual([]);
  });

  it("names per_venue_transport for a tube the route could not honour", () => {
    expect(gapsFor("cheap pints near a tube station in Soho for 4"))
      .toContain("per_venue_transport");
    expect(gapsFor("pints in Soho within walking distance"))
      .toContain("per_venue_transport");
  });
});
