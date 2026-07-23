import { beforeEach, describe, expect, it, vi } from "vitest";

const { isLimitedMock, loadConciergeVenuesMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async (...args: [
    localKey: string,
    durableKey: string,
    limit?: number,
    windowMs?: number,
    opts?: { failClosed?: boolean },
  ]) => {
    void args;
    return false;
  }),
  loadConciergeVenuesMock: vi.fn(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// Hermetic weather: the live refresh workflow rewrites the shipped snapshot
// (0 or 20 observations depending on the day), which would flip the "does not
// invent weather" assertion below. Pin an empty snapshot so this file never
// depends on whatever the cron last wrote. The only weather assertion wants null.
vi.mock("@/public/data/weather/latest.json", () => ({
  default: { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", observations: [] },
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});
vi.mock("@/lib/concierge/venues.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/venues.server")>();
  loadConciergeVenuesMock.mockImplementation(actual.loadConciergeVenues);
  return { ...actual, loadConciergeVenues: loadConciergeVenuesMock };
});

import { GET, POST } from "@/app/api/plans/generate/route";
import { hashIp } from "@/lib/supabase";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { PlanIntakeHandoff } from "@/lib/planIntake";

function generationIntake(
  overrides: Partial<PlanIntakeHandoff> = {},
): PlanIntakeHandoff {
  return {
    version: 1,
    area: { kind: "night-patch", id: "clapham" },
    timeWindow: null,
    groupSize: 4,
    budget: { tier: "standard", limitPence: null },
    accessibilityNeeds: [],
    skipped: ["time-window"],
    ...overrides,
  };
}

function generatedVenue(
  id: string,
  options: Partial<ConciergeVenue> = {},
): ConciergeVenue {
  const index = Number(id.replace(/\D/g, "")) || 0;
  return {
    id,
    name: `Venue ${id}`,
    area: "Lambeth",
    lat: 51.462 + index * 0.001,
    lng: -0.138 + index * 0.001,
    cheapestPrice: 5,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
    },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...options,
  };
}

describe("POST /api/plans/generate", () => {
  beforeEach(() => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
    loadConciergeVenuesMock.mockClear();
  });

  it("warms stable planning data without creating a plan", async () => {
    const response = await GET(new Request("http://localhost/api/plans/generate?cityId=london"));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(isLimitedMock).not.toHaveBeenCalled();
  });

  it("returns an explained three-stop suggestion without creating a Plan", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Four of us after work in Clapham, cheap and lively" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.inferredContext).toMatchObject({ nightArea: "clapham", daypart: "after_work", groupSize: 4 });
    expect(body.stops).toHaveLength(3);
    expect(body.stops[0]).toMatchObject({
      venueId: expect.any(String),
      venueName: expect.any(String),
      reason: expect.any(String),
      provenance: expect.arrayContaining([expect.objectContaining({ kind: "venue_dataset" })]),
      alternatives: expect.arrayContaining([expect.objectContaining({
        venueId: expect.any(String),
        distanceKm: expect.any(Number),
        provenance: expect.any(Array),
      })]),
    });
    expect(body.routeTotals).toMatchObject({
      stopCount: 3,
      straightLineWalkingKm: expect.any(Number),
      estimatedWalkingMinutes: expect.any(Number),
    });
    expect(body.endingRecommendations).toEqual([
      expect.objectContaining({ kind: "food", requiresConfirmation: true }),
      expect.objectContaining({ kind: "get_home", requiresConfirmation: true }),
      expect.objectContaining({ kind: "keep_going", requiresConfirmation: true }),
    ]);
    expect(body.contextEffects).toEqual(expect.arrayContaining(["budget", "daypart", "groupSize", "atmosphere"]));
    expect(body.missingContextEvidence).toEqual([]);
    expect(body.explanations).toEqual(expect.arrayContaining([expect.objectContaining({ field: "nightArea" })]));
    expect(body).not.toHaveProperty("planId");
  });

  it("requires a description or explicit Night Context", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.any(String),
      code: "NIGHT_CONTEXT_REQUIRED",
      retryable: false,
    });
  });

	it("rejects oversized bodies with the public API envelope before rate limiting", async () => {
		const response = await POST(new Request("http://localhost/api/plans/generate", {
			method: "POST",
			body: JSON.stringify({ query: "x".repeat(17_000) }),
		}));
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: "Request body is too large.",
			code: "REQUEST_TOO_LARGE",
			retryable: false,
		});
		expect(isLimitedMock).not.toHaveBeenCalled();
	});

  it("uses the same privacy-safe per-client bucket for local and durable limiting", async () => {
    const rawIp = "203.0.113.42";
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "x-forwarded-for": `${rawIp}, 198.51.100.7` },
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));

    expect(response.status).toBe(200);
    const expectedKey = `plan-generate:${hashIp(rawIp)}`;
    expect(isLimitedMock).toHaveBeenCalledOnce();
    expect(isLimitedMock).toHaveBeenCalledWith(expectedKey, expectedKey, 8, 60_000);
    expect(JSON.stringify(isLimitedMock.mock.calls)).not.toContain(rawIp);
  });

  it("isolates plan-generation budgets by client and preserves the flat 429 contract", async () => {
    for (const rawIp of ["203.0.113.1", "203.0.113.2"]) {
      await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "x-real-ip": rawIp },
        body: JSON.stringify({ query: "A quiet night in Barnes" }),
      }));
    }
    const firstKey = isLimitedMock.mock.calls[0]?.[0];
    const secondKey = isLimitedMock.mock.calls[1]?.[0];
    expect(firstKey).not.toBe(secondKey);

    isLimitedMock.mockResolvedValueOnce(true);
    const limited = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "x-real-ip": "203.0.113.3" },
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "Too many requests.",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("shares one bucket for repeated requests from the same client", async () => {
    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.9" },
        body: JSON.stringify({ query: "A quiet night in Barnes" }),
      }));
    }
    expect(isLimitedMock.mock.calls[0]?.slice(0, 2)).toEqual(isLimitedMock.mock.calls[1]?.slice(0, 2));
  });

  it("does not load venues after rate-limit rejection", async () => {
    isLimitedMock.mockResolvedValueOnce(true);
    const before = loadConciergeVenuesMock.mock.calls.length;
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "x-real-ip": "203.0.113.10" },
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));
    expect(response.status).toBe(429);
    expect(loadConciergeVenuesMock).toHaveBeenCalledTimes(before);
  });

  it("keeps inferred brief fields when the client sends only explicit chip corrections", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "A quiet night in Barnes under £24 each",
        context: { groupSize: 4 },
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inferredContext).toMatchObject({
      nightArea: "barnes",
      atmosphere: ["quiet"],
      budgetLimitPence: 2400,
      groupSize: 4,
    });
  });

  it("retains partial list-based context corrections", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "An evening in Clapham",
        context: {
          atmosphere: ["historic"],
          foodNeeds: ["kebab"],
          accessibility: ["step-free"],
          transportConstraints: ["tube"],
        },
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inferredContext).toMatchObject({
      atmosphere: ["historic"],
      foodNeeds: ["kebab"],
      accessibility: ["step-free"],
      transportConstraints: ["tube"],
    });
    expect(body.contextEffects).toEqual(expect.arrayContaining(["atmosphere", "foodNeeds"]));
    expect(body.missingContextEvidence).toEqual(expect.arrayContaining([
      "venue_accessibility",
      "per_venue_transport",
      "food_terminal_specificity",
    ]));
  });

  it("always returns an editable route with honest confidence for a reviewed area", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      planningConfidence: {
        level: "low",
        routeReady: false,
        missingEvidence: expect.arrayContaining(["opening_hours"]),
        warnings: expect.any(Array),
      },
      nightArea: {
        id: "barnes",
        coverageStatus: "reviewed",
        coverageScore: expect.any(Number),
        missingEvidence: expect.arrayContaining(["opening_hours"]),
        routeReady: false,
        lastReviewedAt: expect.any(String),
      },
    });
    expect(body.district).toMatchObject(body.nightArea);
    expect(body.stops).toHaveLength(3);
  });

  it("does not invent weather when the scheduled cache has no active observation", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "A beer garden night in Clapham" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.weatherEvidence).toBeNull();
    expect(body.planningConfidence.missingEvidence).toContain("live_weather");
    expect(body.contextEffects).not.toContain("weather");
  });

  it("returns route budget evidence while preserving the legacy numeric confidence", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Four of us in Clapham, under £24 each" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.confidence).toEqual(expect.any(Number));
    expect(body.budgetSummary).toMatchObject({
      currency: "GBP",
      limitPence: 2400,
      estimatedPerPersonPence: expect.any(Number),
      estimatedCrewPence: expect.any(Number),
      withinLimit: expect.any(Boolean),
    });
    expect(body.stops[0]).toMatchObject({
      estimatedPintPricePence: expect.any(Number),
      distanceKm: expect.any(Number),
      evidence: expect.any(Array),
    });
  });

  it("does not claim a food ending when official evidence is insufficient", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Late night in Clapham with kebab afterwards" }),
    }));
    const body = await response.json();
    const food = body.endingRecommendations.find((ending: { kind: string }) => ending.kind === "food");

    expect(food.preselected).toBe(false);
    expect(food.options).toEqual([]);
    expect(food.warnings).toContain("No reviewed late-food option is available for this Night Area.");
  });

  it("calculates evidenced food distance from the actual final route stop", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-16T23:00:00.000Z"));
    try {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "Late night in Soho" }),
      }));
      const body = await response.json();
      const food = body.endingRecommendations.find((ending: { kind: string }) => ending.kind === "food");

      expect(response.status).toBe(200);
      expect(food.options).toEqual([expect.objectContaining({
        label: "Balans No.60",
        detail: expect.stringContaining("direct-distance estimate"),
        provenance: [expect.objectContaining({ label: expect.stringContaining("Balans Restaurants") })],
      })]);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    [null, "PLAN_INTAKE_MALFORMED"],
    [{ ...generationIntake(), version: 2 }, "INTAKE_VERSION_UNSUPPORTED"],
    [{ ...generationIntake(), accessibilityNeeds: ["maybe-step-free"] }, "PLAN_INTAKE_MALFORMED"],
  ])("fails closed when a present intake envelope is malformed", async (intakeValue, code) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Clapham", intake: intakeValue }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code, retryable: false });
		expect(isLimitedMock).not.toHaveBeenCalled();
  });

	it("returns an honest unsupported result for Hackney instead of routing Shoreditch", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "A night in Shoreditch",
        context: { nightArea: "shoreditch" },
        intake: generationIntake({ area: { kind: "night-patch", id: "hackney" } }),
      }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "NIGHT_PATCH_UNSUPPORTED",
      details: { patchId: "hackney" },
	});
	});

	it.each(["soho", "shoreditch", "camden", "london-bridge", "brixton", "clapham", "islington"] as const)(
		"generates for mapped Night Patch %s regardless of readiness metadata",
		async (patchId) => {
			const response = await POST(new Request("http://localhost/api/plans/generate", {
				method: "POST",
				body: JSON.stringify({ intake: generationIntake({ area: { kind: "night-patch", id: patchId } }) }),
			}));
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.stops).toHaveLength(3);
			expect(body.contextFieldSources.nightArea).toBe("intake");
		},
	);

	it("generates a low-confidence route when the mapped patch lacks route-feasibility metadata", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Shoreditch",
        intake: generationIntake({ area: { kind: "night-patch", id: "shoreditch" } }),
      }),
    }));
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			inferredContext: { nightArea: "shoreditch" },
			planningConfidence: { level: "low", routeReady: false },
			stops: [{}, {}, {}],
		});
  });

  it("makes the exact intake patch authoritative over conflicting inference", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Shoreditch after work",
        context: { nightArea: "shoreditch" },
        intake: generationIntake(),
      }),
    }));
    const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.inferredContext.nightArea).toBe("clapham");
		expect(body.contextFieldSources.nightArea).toBe("intake");
		expect(body.explanations.filter((reason: { field: string }) => reason.field === "nightArea"))
			.toEqual([expect.objectContaining({ explanation: expect.stringContaining("Plan intake") })]);
    expect(body.constraintReport).toMatchObject({
      version: 1,
      source: "plan-intake-v1",
      hardConstraints: expect.arrayContaining([
        expect.objectContaining({ code: "exact_area", status: "satisfied" }),
        expect.objectContaining({ code: "transport_feasibility", status: "satisfied" }),
      ]),
      softRelaxations: [],
    });
  });

	it("reports end to end that unevidenced group capacity could not shape ranking", async () => {
		const response = await POST(new Request("http://localhost/api/plans/generate", {
			method: "POST",
			body: JSON.stringify({ intake: generationIntake({ groupSize: 8 }) }),
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.constraintReport.softRelaxations).toContainEqual({
			code: "group_fit_unverified",
			message: "The requested group size could not shape ranking because venue capacity is not evidenced in the dataset.",
		});
	});

	it("fails closed when custom candidates cannot be joined to canonical price evidence", async () => {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("v1", { cheapestPrice: 9 }),
      generatedVenue("v2", { cheapestPrice: 6 }),
      generatedVenue("v3", { cheapestPrice: 5 }),
      generatedVenue("v4", { cheapestPrice: 4 }),
      generatedVenue("v5", { cheapestPrice: 3 }),
    ]);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Clapham",
        intake: generationIntake({ budget: { tier: "value", limitPence: 1_200 } }),
      }),
    }));
    const body = await response.json();
		expect(response.status).toBe(422);
		expect(body).toMatchObject({
			code: "GROUNDED_CONSTRAINTS_UNSATISFIED",
			details: { rejected: { budgetEvidence: 5 } },
		});
  });

  it("never returns a stop without confirmed required accessibility", async () => {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("accessible-1", { name: "The Ice Wharf - JD Wetherspoon", area: "Camden" }),
      generatedVenue("accessible-2", { name: "The Ice Wharf - JD Wetherspoon", area: "Camden" }),
      generatedVenue("accessible-3", { name: "The Ice Wharf - JD Wetherspoon", area: "Camden" }),
      generatedVenue("accessible-4", { name: "The Ice Wharf - JD Wetherspoon", area: "Camden" }),
      generatedVenue("unknown-5", { name: "Unknown Access", cheapestPrice: 1 }),
    ]);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Clapham",
        intake: generationIntake({ accessibilityNeeds: ["step-free"] }),
      }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.stops).toHaveLength(3);
    expect(body.stops.every((stop: { venueName: string }) => stop.venueName === "The Ice Wharf - JD Wetherspoon")).toBe(true);
    expect(body.stops.flatMap((stop: { alternatives: Array<{ venueName: string }> }) => stop.alternatives)
      .every((alternative: { venueName: string }) => alternative.venueName === "The Ice Wharf - JD Wetherspoon")).toBe(true);
    expect(body.constraintReport.hardConstraints).toContainEqual(expect.objectContaining({
      code: "accessibility",
      status: "satisfied",
    }));
  });

  it("returns no route rather than treating unknown access facts as accessible", async () => {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("unknown-1"),
      generatedVenue("unknown-2"),
      generatedVenue("unknown-3"),
      generatedVenue("unknown-4"),
    ]);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Clapham",
        intake: generationIntake({ accessibilityNeeds: ["step-free"] }),
      }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "GROUNDED_CONSTRAINTS_UNSATISFIED",
      details: { rejected: { accessibility: 4 } },
    });
  });

	it.each(["seating", "low-noise"] as const)(
		"returns no real-catalogue route when distinct %s evidence is unavailable",
		async (need) => {
			const response = await POST(new Request("http://localhost/api/plans/generate", {
				method: "POST",
				body: JSON.stringify({ intake: generationIntake({ accessibilityNeeds: [need] }) }),
			}));
			expect(response.status).toBe(422);
			expect(await response.json()).toMatchObject({ code: "GROUNDED_CONSTRAINTS_UNSATISFIED" });
		},
	);

  it("returns no route when a dated route lacks opening evidence", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-20T12:00:00.000Z"));
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("ordinary-1"),
      generatedVenue("ordinary-2"),
      generatedVenue("ordinary-3"),
      generatedVenue("ordinary-4"),
    ]);
    try {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ intake: generationIntake({
          timeWindow: {
            id: "after-work",
            start: "17:30",
            end: "20:30",
            exactStartIso: "2026-07-20T16:30:00.000Z",
          },
          skipped: [],
        }) }),
      }));
      const body = await response.json();
      expect(response.status).toBe(422);
      expect(body).toMatchObject({ code: "GROUNDED_CONSTRAINTS_UNSATISFIED" });
    } finally {
      clock.mockRestore();
    }
  });
});
