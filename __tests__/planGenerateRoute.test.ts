import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { verifyPlanGroundingProof } from "@/lib/planGrounding.server";
import { hashIp } from "@/lib/supabase";

describe("POST /api/plans/generate", () => {
  beforeEach(() => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
    loadConciergeVenuesMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
    delete process.env.RATE_LIMIT_SALT;
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
    expect(body.grounded).toBe(true);
    expect(body.inferredContext).toMatchObject({ nightArea: "clapham", daypart: "after_work", groupSize: 4 });
    expect(body.stops).toHaveLength(3);
    expect(verifyPlanGroundingProof(
      body.groundingProof,
      body.stops.map((stop: { venueId: string }) => stop.venueId),
      body.operationKey,
    )).toBe(true);
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

  it("returns an actionable retry response when trusted proof signing is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
    delete process.env.RATE_LIMIT_SALT;

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Four of us after work in Clapham, cheap and lively" }),
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({
      error: "Verified Plan signing is temporarily unavailable. Try again shortly.",
      code: "PLAN_SIGNING_UNAVAILABLE",
      retryable: true,
    });
    expect(isLimitedMock).not.toHaveBeenCalled();
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
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
});
