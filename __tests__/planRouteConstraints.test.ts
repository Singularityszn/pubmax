import { describe, expect, it } from "vitest";

import {
  parsePlanGenerationIntake,
  parsedPlanIntakeContextPatch,
  planVisitWindows,
  selectGroundedPlanRoute,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
} from "@/lib/planRoute";
import type { PlanAccessibilityNeed, PlanIntakeHandoff } from "@/lib/planIntake";
import type { VenueAccessibility } from "@/lib/venueAccessibility";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function intake(overrides: Partial<PlanIntakeHandoff> = {}): PlanIntakeHandoff {
  return {
    version: 1,
    area: { kind: "night-patch", id: "clapham" },
    timeWindow: {
      id: "after-work",
      start: "17:30",
      end: "20:30",
      exactStartIso: "2026-07-20T16:30:00.000Z",
    },
    groupSize: 4,
    budget: { tier: "standard", limitPence: null },
    accessibilityNeeds: [],
    skipped: [],
    ...overrides,
  };
}

function candidate(
  id: string,
  overrides: Partial<GroundedPlanRouteCandidate<string>> = {},
): GroundedPlanRouteCandidate<string> {
  const ordinal = Number(id.replace(/\D/g, "")) || 0;
  return {
    value: id,
    venueId: id,
    venueName: `Venue ${id}`,
    score: 100 - ordinal,
    lat: 51.462 + ordinal * 0.001,
    lng: -0.138 + ordinal * 0.001,
    pricePence: 500,
    promoted: false,
    avoidedByReviewedSignal: false,
    accessibility: undefined,
    opening: { openAtVisit: [true, true, true], source: null },
    ...overrides,
  };
}

function constraints(
  overrides: Partial<GroundedPlanRouteConstraints> = {},
): GroundedPlanRouteConstraints {
  return {
    exactArea: "clapham",
    accessibilityNeeds: [],
    budgetLimitPence: null,
    budgetTier: "standard",
    groupSize: 4,
    transportConstraints: [],
    visitWindows: [],
    ...overrides,
  };
}

function selectedAndAlternatives<T>(selection: ReturnType<typeof selectGroundedPlanRoute<T>>): GroundedPlanRouteCandidate<T>[] {
  if (!selection.ok) return [];
  return [...selection.stops, ...selection.alternatives.flat()];
}

describe("strict Plan intake generation handoff", () => {
  it("keeps exact patch and dated London window authoritative", () => {
    const parsed = parsePlanGenerationIntake(intake(), NOW);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        exactNightArea: "clapham",
        unsupportedPatch: null,
        exactStartIso: "2026-07-20T16:30:00.000Z",
        windowEndIso: "2026-07-20T19:30:00.000Z",
      },
    });
    if (!parsed.ok) throw new Error("expected valid intake");
    expect(parsedPlanIntakeContextPatch(parsed.value)).toEqual({
      nightArea: "clapham",
      daypart: "after_work",
      groupSize: 4,
      budget: "standard",
      budgetLimitPence: null,
    });
    expect(planVisitWindows(parsed.value)).toEqual([
      { startsAt: "2026-07-20T16:30:00.000Z", endsAt: "2026-07-20T17:20:00.000Z" },
      { startsAt: "2026-07-20T17:30:00.000Z", endsAt: "2026-07-20T18:20:00.000Z" },
      { startsAt: "2026-07-20T18:30:00.000Z", endsAt: "2026-07-20T19:20:00.000Z" },
    ]);
  });

  it("keeps Hackney as an honest unsupported patch instead of coercing Shoreditch", () => {
    const parsed = parsePlanGenerationIntake(intake({
      area: { kind: "night-patch", id: "hackney" },
      timeWindow: null,
    }), NOW);
    expect(parsed).toMatchObject({
      ok: true,
      value: { exactNightArea: null, unsupportedPatch: "hackney" },
    });
    if (!parsed.ok) throw new Error("expected valid intake");
    expect(parsedPlanIntakeContextPatch(parsed.value)).not.toHaveProperty("nightArea");
  });

  const malformedCases: Array<[string, unknown, string]> = [
    ["null", null, "PLAN_INTAKE_MALFORMED"],
    ["unknown version", { ...intake(), version: 2 }, "INTAKE_VERSION_UNSUPPORTED"],
    ["unknown patch", { ...intake(), area: { kind: "night-patch", id: "hackney-central" } }, "PLAN_INTAKE_MALFORMED"],
    ["wrong area kind", { ...intake(), area: { kind: "borough", id: "clapham" } }, "PLAN_INTAKE_MALFORMED"],
    ["forged window", { ...intake(), timeWindow: { ...intake().timeWindow, start: "18:00" } }, "PLAN_INTAKE_MALFORMED"],
    ["outside preset", { ...intake(), timeWindow: { ...intake().timeWindow, exactStartIso: "2026-07-20T21:30:00.000Z" } }, "PLAN_INTAKE_MALFORMED"],
    ["past start", { ...intake(), timeWindow: { ...intake().timeWindow, exactStartIso: "2026-07-20T10:00:00.000Z" } }, "PLAN_INTAKE_MALFORMED"],
    ["fractional group", { ...intake(), groupSize: 2.5 }, "PLAN_INTAKE_MALFORMED"],
    ["unknown access need", { ...intake(), accessibilityNeeds: ["probably-step-free"] }, "PLAN_INTAKE_MALFORMED"],
    ["duplicate skipped state", { ...intake(), skipped: ["budget", "budget"] }, "PLAN_INTAKE_MALFORMED"],
  ];

  for (const [label, value, code] of malformedCases) {
    it(`fails closed for ${label}`, () => {
      expect(parsePlanGenerationIntake(value, NOW)).toMatchObject({ ok: false, code });
    });
  }

  it("rejects a canonical but passed exact start without rolling it to another date", () => {
    const parsed = parsePlanGenerationIntake(
      intake({ timeWindow: { ...intake().timeWindow!, exactStartIso: "2026-07-20T16:30:00.000Z" } }),
      new Date("2026-07-20T16:30:00.000Z"),
    );
    expect(parsed).toMatchObject({ ok: false, code: "INTAKE_START_NOT_FUTURE" });
  });

  it("returns no dated schedule when a late custom start leaves too little preset time", () => {
    const parsed = parsePlanGenerationIntake(intake({
      timeWindow: { ...intake().timeWindow!, exactStartIso: "2026-07-20T18:00:00.000Z" },
    }), NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected valid intake");
    expect(planVisitWindows(parsed.value)).toBeNull();
  });
});

describe("hard route constraint fences", () => {
  const accessFacts: Record<PlanAccessibilityNeed, VenueAccessibility> = {
    "step-free": { stepFree: true },
    "accessible-toilet": { accessibleToilet: true },
    seating: { seatedService: true },
    "low-noise": { quietHours: "Quieter before 19:00" },
  };

  for (const need of Object.keys(accessFacts) as PlanAccessibilityNeed[]) {
    it(`never returns an unknown or failing ${need} stop or swap alternative`, () => {
      const good = [1, 2, 3, 4].map((index) => candidate(`good-${index}`, {
        score: 20 - index,
        accessibility: accessFacts[need],
      }));
      const selection = selectGroundedPlanRoute([
        candidate("unknown", { score: 1_000 }),
        candidate("known-false", {
          score: 999,
          accessibility: need === "low-noise" ? { quietHours: "" } : {
            stepFree: false,
            accessibleToilet: false,
            seatedService: false,
          },
        }),
        ...good,
      ], constraints({ accessibilityNeeds: [need] }));

      expect(selection.ok).toBe(true);
      expect(selectedAndAlternatives(selection).every((item) => item.accessibility === accessFacts[need])).toBe(true);
      if (selection.ok) {
        expect(selection.constraintReport.hardConstraints).toContainEqual(expect.objectContaining({
          code: "accessibility",
          status: "satisfied",
        }));
      }
    });
  }

  it("fails closed when required accessibility evidence is unavailable", () => {
    const selection = selectGroundedPlanRoute(
      [candidate("a"), candidate("b"), candidate("c"), candidate("d")],
      constraints({ accessibilityNeeds: ["step-free"] }),
    );
    expect(selection).toMatchObject({
      ok: false,
      eligibleCandidateCount: 0,
      rejected: { accessibility: 4 },
    });
  });

  it("excludes promoted venues and active reviewed avoid signals from stops and alternatives", () => {
    const selection = selectGroundedPlanRoute([
      candidate("promoted", { score: 1_000, promoted: true }),
      candidate("avoid", { score: 999, avoidedByReviewedSignal: true }),
      ...[1, 2, 3, 4].map((index) => candidate(`safe-${index}`, { score: 20 - index })),
    ], constraints());

    expect(selection.ok).toBe(true);
    expect(selectedAndAlternatives(selection).map((item) => item.venueId)).not.toEqual(
      expect.arrayContaining(["promoted", "avoid"]),
    );
  });

  it("excludes known-closed stops and visibly flags permitted unknown opening evidence", () => {
    const selection = selectGroundedPlanRoute([
      candidate("closed", { score: 1_000, opening: { openAtVisit: [false, false, false], source: null } }),
      candidate("unknown", { score: 100, opening: { openAtVisit: [null, null, null], source: null } }),
      candidate("open-1", { score: 90 }),
      candidate("open-2", { score: 80 }),
      candidate("open-3", { score: 70 }),
    ], constraints({
      visitWindows: [
        { startsAt: "2026-07-20T16:30:00.000Z", endsAt: "2026-07-20T17:20:00.000Z" },
        { startsAt: "2026-07-20T17:30:00.000Z", endsAt: "2026-07-20T18:20:00.000Z" },
        { startsAt: "2026-07-20T18:30:00.000Z", endsAt: "2026-07-20T19:20:00.000Z" },
      ],
    }));

    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.stops.map((stop) => stop.venueId)).not.toContain("closed");
    expect(selection.alternatives.flat().map((stop) => stop.venueId)).not.toContain("closed");
    expect(selection.stops.find((stop) => stop.venueId === "unknown")?.constraintFlags)
      .toContainEqual(expect.objectContaining({ code: "opening_hours_unconfirmed" }));
    expect(selection.constraintReport.hardConstraints).toContainEqual(expect.objectContaining({
      code: "opening_hours",
      status: "flagged",
    }));
  });

  it("keeps infeasible long walking legs out of the selected route and every alternative", () => {
    const selection = selectGroundedPlanRoute([
      candidate("far", { score: 1_000, lat: 51.55, lng: -0.02 }),
      ...[1, 2, 3, 4].map((index) => candidate(`compact-${index}`, { score: 20 - index })),
    ], constraints());
    expect(selection.ok).toBe(true);
    expect(selectedAndAlternatives(selection).map((item) => item.venueId)).not.toContain("far");
  });

  it("returns no route when every three-stop combination breaches the transport fence", () => {
    const selection = selectGroundedPlanRoute([
      candidate("west", { lat: 51.46, lng: -0.2 }),
      candidate("centre", { lat: 51.51, lng: -0.13 }),
      candidate("east", { lat: 51.54, lng: -0.04 }),
    ], constraints());
    expect(selection).toMatchObject({ ok: false, eligibleCandidateCount: 3 });
  });

  it("explicitly flags requested per-venue transport evidence that the dataset cannot prove", () => {
    const selection = selectGroundedPlanRoute(
      [candidate("a"), candidate("b"), candidate("c")],
      constraints({ transportConstraints: ["tube"] }),
    );
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.constraintReport.hardConstraints).toContainEqual(expect.objectContaining({
      code: "transport_feasibility",
      status: "flagged",
      message: expect.stringContaining("per-venue transport evidence is unavailable"),
    }));
  });

  it("never silently exceeds a ceiling across generated combinations", () => {
    for (let seed = 1; seed <= 96; seed += 1) {
      const limit = 1_500 + (seed % 18) * 125;
      const generated = Array.from({ length: 10 }, (_, index) => candidate(`seed-${seed}-${index}`, {
        score: (seed * 37 + index * 19) % 101,
        pricePence: 250 + ((seed * 83 + index * 211) % 1_250),
      }));
      const guaranteed = [0, 1, 2].map((index) => candidate(`guaranteed-${seed}-${index}`, {
        score: index,
        pricePence: Math.floor(limit / 4),
      }));
      const selection = selectGroundedPlanRoute([...generated, ...guaranteed], constraints({ budgetLimitPence: limit }));
      expect(selection.ok, `seed ${seed}`).toBe(true);
      if (!selection.ok) continue;
      const selectedTotal = selection.stops.reduce((total, stop) => total + stop.pricePence!, 0);
      expect(selectedTotal, `selected seed ${seed}`).toBeLessThanOrEqual(limit);
      for (let position = 0; position < 3; position += 1) {
        for (const alternative of selection.alternatives[position]) {
          const replacementTotal = selection.stops.reduce(
            (total, stop, index) => total + (index === position ? alternative.pricePence! : stop.pricePence!),
            0,
          );
          expect(replacementTotal, `alternative seed ${seed}`).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it("fails closed on unknown price evidence or an impossible ceiling", () => {
    const selection = selectGroundedPlanRoute([
      candidate("unknown", { pricePence: null }),
      candidate("too-much-1", { pricePence: 900 }),
      candidate("too-much-2", { pricePence: 900 }),
      candidate("too-much-3", { pricePence: 900 }),
    ], constraints({ budgetLimitPence: 1_500 }));
    expect(selection).toMatchObject({ ok: false, rejected: { budgetEvidence: 1 } });
  });
});

describe("deterministic soft-relaxation disclosures", () => {
  it("discloses capacity and incomplete value evidence identically regardless of candidate order", () => {
    const rows = [
      candidate("unknown-price", { score: 100, pricePence: null }),
      candidate("a", { score: 90 }),
      candidate("b", { score: 80 }),
      candidate("c", { score: 70 }),
    ];
    const requested = constraints({ budgetTier: "value", groupSize: 8 });
    const first = selectGroundedPlanRoute(rows, requested);
    const second = selectGroundedPlanRoute([...rows].reverse(), requested);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.stops.map((stop) => stop.venueId)).toEqual(second.stops.map((stop) => stop.venueId));
    expect(first.constraintReport.softRelaxations).toEqual([
      expect.objectContaining({ code: "group_fit_unverified" }),
      expect.objectContaining({ code: "value_price_evidence_incomplete" }),
    ]);
    expect(second.constraintReport.softRelaxations).toEqual(first.constraintReport.softRelaxations);
  });
});
