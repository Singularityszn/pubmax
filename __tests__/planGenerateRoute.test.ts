import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { GET, POST } from "@/app/api/plans/generate/route";

describe("POST /api/plans/generate", () => {
  it("warms stable planning data without creating a plan", async () => {
    const response = await GET(new Request("http://localhost/api/plans/generate?cityId=london"));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
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

  it("keeps two grounded food endings while ranking an explicit food need first", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Late night in Clapham with kebab afterwards" }),
    }));
    const body = await response.json();
    const food = body.endingRecommendations.find((ending: { kind: string }) => ending.kind === "food");

    expect(food.preselected).toBe(true);
    expect(food.options).toHaveLength(2);
    expect(food.options[0]).toMatchObject({ label: "Kebab Corner", closingConfidence: "unknown" });
  });
});
