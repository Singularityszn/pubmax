import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The Christmas crawl template's words go through the real generator, keyless,
// on the shipped venue record, and come back a grounded route. A template that
// 422s on its own words would be a promise the planner cannot keep.

const { isLimitedMock } = vi.hoisted(() => ({ isLimitedMock: vi.fn(async () => false) }));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/public/data/weather/latest.json", () => ({
  default: { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", observations: [] },
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});
vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLegRoute: vi.fn(async () => null),
  orsApiKey: () => null,
}));
vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => ({ getLeg: async () => null, putLeg: async () => undefined }),
}));

import { POST } from "@/app/api/plans/generate/route";
import { planTemplatesFor } from "@/lib/planTemplates";
import {
  createPlanIntakeDraft,
  planIntakeHandoff,
  skipRemainingPlanIntake,
} from "@/lib/planIntake";

describe("the Christmas crawl through POST /api/plans/generate", () => {
  it("returns a grounded three-stop route from the template's own words", async () => {
    const christmas = planTemplatesFor(true)[0]!;
    expect(christmas.id).toBe("christmas-crawl");
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: christmas.conciergeQuery,
        intake: planIntakeHandoff(skipRemainingPlanIntake(createPlanIntakeDraft())),
      }),
    }));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.grounded).toBe(true);
    expect(body.stops).toHaveLength(3);
    expect(body.inferredContext).toMatchObject({ nightArea: "victoria", groupSize: 8, budget: "value" });
    // Nothing in the answer is invented for the season: the stops carry the
    // same record fields any route does, and no Christmas claim.
    expect(JSON.stringify(body.stops)).not.toMatch(/christmas|festive|decorat/i);
  });
});
