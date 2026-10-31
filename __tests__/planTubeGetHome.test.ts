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

  // TRANSPORT WORDS NEVER REFUSE (launch review, 30 Oct 2026). "Short walk
  // between pubs" is the most natural sentence a Londoner types, and it used to
  // 422 with no hint. A walk word is met by the optimiser's own leg rule, and a
  // tube word is a soft preference; each earns a line in the report instead.
  it("builds the route for a tube or a walk word, and says it heard each", () => {
    for (const words of [["tube"], ["walking"], ["tube", "walking"]]) {
      const result = selectGroundedPlanRoute(candidates, constraints(words));
      expect(result.ok, words.join()).toBe(true);
      if (!result.ok) continue;
      const codes = result.constraintReport.hardConstraints.map((line) => line.code);
      expect(codes.includes("short_walks"), words.join()).toBe(words.includes("walking"));
    }
    const walked = selectGroundedPlanRoute(candidates, constraints(["walking"]));
    expect(walked.ok && walked.constraintReport.hardConstraints.find((line) => line.code === "short_walks"))
      .toEqual({ code: "short_walks", status: "satisfied", message: "Short walks: every leg is under 1.6 km." });
    expect(selectAnchoredGroundedPlanRoute(candidates, constraints(["tube", "walking"]), "a"))
      .toMatchObject({ ok: true, outcome: "route" });
  });

  it("routes the walk rule the same sentence states, with the short-walks line", async () => {
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
    expect(result.ok).toBe(true);
    if (!result.ok || result.legacy) throw new Error("expected a grounded route");
    expect(result.selection.constraintReport.hardConstraints).toContainEqual(
      { code: "short_walks", status: "satisfied", message: "Short walks: every leg is under 1.6 km." },
    );
  });

  it("reads a short walk between pubs as a preference, never a refusal", async () => {
    const { context } = inferNightContext("short walk between pubs in Soho", NOW);
    expect(context.transportConstraints).toEqual(["walking"]);
    const result = await selectPlanGenerationCandidates(
      [0, 1, 2, 3].map((ordinal) => scoredCandidate(`soho-${ordinal}`, ordinal)),
      context as NightContext,
      null,
      NOW.getTime(),
    );
    expect(result.ok).toBe(true);
  });

  it("falls back to the plain route when only a walk word asked for one and none fits", async () => {
    const { context } = inferNightContext("short walk between pubs in Soho", NOW);
    // Three pubs kilometres apart: no leg under 1.6 km, so the grounded search
    // finds nothing, and the walk word alone may not refuse the plan.
    const spread = [0, 1, 2].map((ordinal) => {
      const candidate = scoredCandidate(`far-${ordinal}`, ordinal);
      return { ...candidate, venue: { ...candidate.venue, lat: 51.45 + ordinal * 0.05 } };
    });
    const result = await selectPlanGenerationCandidates(spread, context as NightContext, null, NOW.getTime());
    expect(result).toMatchObject({ ok: true, legacy: true });
  });

  it("says every stop is near a station when the station table can show it", async () => {
    const { context } = inferNightContext("cheap pints near a tube station in Soho for 4", NOW);
    const result = await selectPlanGenerationCandidates(
      [0, 1, 2, 3].map((ordinal) => scoredCandidate(`soho-${ordinal}`, ordinal)),
      context as NightContext,
      null,
      NOW.getTime(),
    );
    if (!result.ok || result.legacy) throw new Error("expected a grounded route");
    expect(result.selection.constraintReport.hardConstraints).toContainEqual(
      { code: "tube_stations", status: "satisfied", message: "Tube: every stop is within 600 m of a station." },
    );
  });

  it("says it could not check station distance where the station table is silent", async () => {
    const { context } = inferNightContext("pints near a tube station in Clapham", NOW);
    expect(context.transportConstraints).toEqual(["tube"]);
    const clapham = [0, 1, 2, 3].map((ordinal) => {
      const candidate = scoredCandidate(`clapham-${ordinal}`, ordinal);
      return { ...candidate, venue: { ...candidate.venue, lat: 51.462 + ordinal * 0.0005, lng: -0.138 } };
    });
    const result = await selectPlanGenerationCandidates(clapham, context as NightContext, null, NOW.getTime());
    if (!result.ok || result.legacy) throw new Error("expected a grounded route");
    expect(result.selection.constraintReport.hardConstraints).toContainEqual(
      { code: "tube_stations", status: "flagged", message: "Tube: we could not check station distance for these stops." },
    );
  });

  it("reads underground and station words as the same tube preference", () => {
    for (const query of ["pints in Soho near the underground", "pubs near a station in Soho"]) {
      expect(inferNightContext(query, NOW).context.transportConstraints, query).toEqual(["tube"]);
    }
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

  it("names per_venue_transport for a tube the route could not fully check", () => {
    expect(gapsFor("cheap pints near a tube station in Soho for 4"))
      .toContain("per_venue_transport");
  });

  it("costs a walk word no confidence, because every leg is already short", () => {
    expect(gapsFor("pints in Soho within walking distance")).not.toContain("per_venue_transport");
  });
});
