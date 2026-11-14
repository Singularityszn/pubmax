import { describe, expect, it } from "vitest";

import {
  selectAnchoredGroundedPlanRoute,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
} from "@/lib/planRouteOptimizer";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");
const SOURCE = {
  label: "Pub menu",
  url: "https://example.com/menu",
  observedAt: new Date(NOW).toISOString(),
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

function ids(stops: readonly { venueId: string }[]): string[] {
  return stops.map((stop) => stop.venueId);
}

describe("selectAnchoredGroundedPlanRoute", () => {
  it("keeps the anchor as Stop 1 even when it has the highest score", () => {
    const result = selectAnchoredGroundedPlanRoute(
      [candidate("a", { score: 10 }), candidate("b", { score: 5 }), candidate("c", { score: 4 }), candidate("d", { score: 3 })],
      constraints(),
      "a",
    );
    expect(result.ok && result.outcome).toBe("route");
    if (result.ok && result.outcome === "route") {
      expect(ids(result.stops)).toEqual(["a", "b", "c"]);
      expect(defined(result.stops[0]).position).toBe(0);
    }
  });

  it("keeps the anchor as Stop 1 even when it has the lowest score", () => {
    const result = selectAnchoredGroundedPlanRoute(
      [candidate("a", { score: 1 }), candidate("b", { score: 10 }), candidate("c", { score: 9 }), candidate("d", { score: 8 })],
      constraints(),
      "a",
    );
    expect(result.ok && result.outcome === "route" && defined(result.stops[0]).venueId).toBe("a");
    if (result.ok && result.outcome === "route") {
      // Highest-scoring companions fill Stops 2 and 3; the anchor never moves.
      expect(ids(result.stops)).toEqual(["a", "b", "c"]);
    }
  });

  it("gives Stop 1 no alternatives and offers companion swaps elsewhere", () => {
    const result = selectAnchoredGroundedPlanRoute(
      [candidate("a", { score: 10 }), candidate("b", { score: 5 }), candidate("c", { score: 4 }), candidate("d", { score: 3 })],
      constraints(),
      "a",
    );
    if (result.ok && result.outcome === "route") {
      expect(result.alternatives[0]).toEqual([]);
      const swaps = [...defined(result.alternatives[1]), ...defined(result.alternatives[2])].map((stop) => stop.venueId);
      expect(swaps).toContain("d");
      expect(swaps).not.toContain("a");
    }
  });

  it("picks the shorter companion ordering when scores tie", () => {
    // A and C share a point; B sits ~0.55km north. [A,C,B] walks less than [A,B,C].
    const result = selectAnchoredGroundedPlanRoute(
      [
        candidate("a", { lat: 51.5, lng: -0.1 }),
        candidate("b", { lat: 51.505, lng: -0.1 }),
        candidate("c", { lat: 51.5, lng: -0.1 }),
      ],
      constraints(),
      "a",
    );
    expect(result.ok && result.outcome === "route" && ids(result.stops)).toEqual(["a", "c", "b"]);
  });

  it("uses the lexical route key when score and distance tie", () => {
    const result = selectAnchoredGroundedPlanRoute(
      [candidate("a"), candidate("d"), candidate("c"), candidate("b")],
      constraints(),
      "a",
    );

    expect(result.ok && result.outcome === "route" && ids(result.stops)).toEqual(["a", "b", "c"]);
  });

  it("keeps the anchor score in the pruning bound", () => {
    const result = selectAnchoredGroundedPlanRoute(
      [
        candidate("a", { score: 100, lng: -0.1 }),
        candidate("b", { score: 9, lng: -0.082 }),
        candidate("c", { score: 7, lng: -0.118 }),
        candidate("d", { score: 6, lng: -0.118 }),
        candidate("f", { score: 1, lng: -0.082 }),
      ],
      constraints(),
      "a",
    );

    // b can only form a valid route with low-scoring f. c + d scores higher,
    // but the search reaches that branch after it has an incumbent. Dropping
    // the fixed anchor score from the upper bound would prune c + d unsafely.
    expect(result.ok && result.outcome === "route" && ids(result.stops)).toEqual(["a", "c", "d"]);
  });

  it("never duplicates the anchor when a stray candidate reuses its id", () => {
    const result = selectAnchoredGroundedPlanRoute(
      [candidate("a", { score: 10 }), candidate("a", { score: 2 }), candidate("b", { score: 5 }), candidate("c", { score: 4 })],
      constraints(),
      "a",
    );
    if (result.ok && result.outcome === "route") {
      expect(ids(result.stops)).toEqual(["a", "b", "c"]);
      expect(ids(result.stops).filter((id) => id === "a")).toHaveLength(1);
    }
  });

  it("falls back to anchor-only with one or zero companions", () => {
    const oneCompanion = selectAnchoredGroundedPlanRoute(
      [candidate("a"), candidate("b")],
      constraints(),
      "a",
    );
    expect(oneCompanion).toMatchObject({ ok: true, outcome: "anchor-only", reason: "ANCHOR_COMPANIONS_INSUFFICIENT" });
    expect(oneCompanion.ok && oneCompanion.outcome === "anchor-only" && oneCompanion.anchor.venueId).toBe("a");

    const noCompanion = selectAnchoredGroundedPlanRoute([candidate("a")], constraints(), "a");
    expect(noCompanion).toMatchObject({ ok: true, outcome: "anchor-only" });
  });

  it("excludes promoted and avoided companions but keeps the anchor", () => {
    const result = selectAnchoredGroundedPlanRoute(
      [
        candidate("a", { score: 10 }),
        candidate("b", { score: 9, promoted: true }),
        candidate("c", { score: 8, avoidedByReviewedSignal: true }),
        candidate("d", { score: 2 }),
      ],
      constraints(),
      "a",
    );
    // Only d is an eligible companion, so a grounded three-Stop route is impossible.
    expect(result).toMatchObject({ ok: true, outcome: "anchor-only" });
  });

  describe.each([0, 2])("with %i eligible companions", (companionCount) => {
    const confirmedAccess = {
      stepFree: { confirmed: true as const, source: SOURCE },
      accessibleToilet: { confirmed: true as const, source: SOURCE },
      seating: { confirmed: true as const, source: SOURCE },
    };
    const companions = Array.from({ length: companionCount }, (_, index) => candidate(`companion-${index}`, {
      access: confirmedAccess,
      price: { pence: 100, source: SOURCE, confidenceState: "fresh" },
    }));

    it.each<{
      requirement: string;
      anchor: Partial<GroundedPlanRouteCandidate<string>>;
      required: Partial<GroundedPlanRouteConstraints>;
    }>([
      {
        requirement: "the reviewed safety rule",
        anchor: { avoidedByReviewedSignal: true },
        required: {},
      },
      {
        requirement: "the promoted venue exclusion",
        anchor: { promoted: true },
        required: {},
      },
      ...(["step-free", "accessible-toilet", "seating"] as const).map((need) => ({
        requirement: `required ${need} access without evidence`,
        anchor: {},
        required: { accessibilityNeeds: [need] },
      })),
      {
        requirement: "a hard budget below the anchor's sourced price",
        anchor: { price: { pence: 501, source: SOURCE, confidenceState: "fresh" } },
        required: { budgetLimitPence: 500 },
      },
      {
        requirement: "a hard budget without an anchor price",
        anchor: {},
        required: { budgetLimitPence: 500 },
      },
      {
        requirement: "a hard budget with an unsourced anchor price",
        anchor: { price: { pence: 100, source: null, confidenceState: "fresh" } },
        required: { budgetLimitPence: 500 },
      },
      {
        requirement: "a hard budget with a stale anchor price",
        anchor: { price: { pence: 100, source: { ...SOURCE, observedAt: "2026-01-01T12:00:00.000Z" }, confidenceState: "stale" } },
        required: { budgetLimitPence: 500 },
      },
    ])("refuses an anchor that fails $requirement", ({ anchor, required }) => {
      const result = selectAnchoredGroundedPlanRoute(
        [candidate("a", anchor), ...companions],
        constraints(required),
        "a",
      );

      expect(result).toMatchObject({ ok: false });
    });

    it("accepts evidenced access and a sourced total exactly at the hard budget", () => {
      const result = selectAnchoredGroundedPlanRoute(
        [candidate("a", {
          access: confirmedAccess,
          price: { pence: 500 - companionCount * 100, source: SOURCE, confidenceState: "fresh" },
        }), ...companions],
        constraints({ accessibilityNeeds: ["step-free", "accessible-toilet", "seating"], budgetLimitPence: 500 }),
        "a",
      );

      expect(result).toMatchObject({ ok: true, outcome: companionCount === 0 ? "anchor-only" : "route" });
    });
  });

  it("returns anchor-only when companions are beyond walking distance", () => {
    const result = selectAnchoredGroundedPlanRoute(
      [
        candidate("a", { lat: 51.5, lng: -0.1 }),
        candidate("b", { lat: 51.52, lng: -0.1 }),
        candidate("c", { lat: 51.48, lng: -0.1 }),
      ],
      constraints(),
      "a",
    );
    expect(result).toMatchObject({ ok: true, outcome: "anchor-only" });
  });

  it.each([
    { startsAt: null, expected: false },
    { startsAt: "2026-07-20T12:00:00.000Z", expected: false },
    { startsAt: "2026-07-20T16:30:00.000Z", expected: true },
  ])("checks required quieter spaces at the anchor's visit time: $startsAt", ({ startsAt, expected }) => {
    const result = selectAnchoredGroundedPlanRoute([
      candidate("a", { access: {
        lowNoise: { ranges: [{ weekday: "Monday", startsAt: "17:00", endsAt: "21:00" }], source: SOURCE },
      } }),
    ], constraints({
      accessibilityNeeds: ["low-noise"],
      routeWindow: startsAt ? { startsAt, endsAt: "2026-07-20T20:30:00.000Z" } : null,
    }), "a");

    if (expected) {
      expect(result).toMatchObject({ ok: true, outcome: "anchor-only" });
    } else {
      expect(result).toMatchObject({ ok: false, reason: "ANCHOR_INELIGIBLE",
        failure: { requirement: "accessibility", need: "low-noise" } });
    }
  });

  it("reports ANCHOR_MISSING when the anchor is not among candidates", () => {
    const result = selectAnchoredGroundedPlanRoute(
      [candidate("b"), candidate("c"), candidate("d")],
      constraints(),
      "a",
    );
    expect(result).toEqual({ ok: false, reason: "ANCHOR_MISSING" });
  });
});
