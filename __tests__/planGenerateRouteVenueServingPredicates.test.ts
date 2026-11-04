import { describe, expect, it, vi } from "vitest";

import {
  installPlanGenerateRouteHooks,
  PLAN_GENERATION_TEST_NOW,
  POST,
  preparePlanGeneration,
} from "./helpers/planGenerateRoute";

// POST /api/plans/generate: venue serving predicates stay independent from
// route budgets.
// The mocks, fixtures and hooks are shared in __tests__/helpers/planGenerateRoute.ts.
describe("POST /api/plans/generate", () => {
  installPlanGenerateRouteHooks();

  it.each([
    "beer", "drinks", "real ale", "cider", "soft drinks", "mixed drinks and food",
    "locally brewed craft beverages", "pizza", "beer and pizza", "beer plus pizza", "beer & pizza",
  ].flatMap((object) => [
    "", "each ", "all ", "both ", "one ", "two ", "three ", "each regularly ", "all currently ",
    "with a garden ", "with a sunny terrace ", "with two bars ", "with a kitchen ", "with a restaurant ", "with a rooftop ", "with 2 bars ", "with a shed ",
    "with an outdoor area regularly ", "with a terrace and a garden ",
  ].flatMap((antecedent) => {
    const amenity = `${antecedent}serving ${object}`;
    return [
      { query: `3 pubs in Soho ${amenity}, under£20 per person` },
      { query: `3 pubs in Soho, under£20 per person, ${amenity}` },
      ...[
        `${amenity}, under£20 per person`,
        `under£20 per person, ${amenity}`,
      ].filter((field) => field.length <= 40).map((field) => ({
        query: "3 pubs in Clapham", context: { foodNeeds: [field] },
      })),
      ...(amenity.length <= 40 ? [
        { query: "3 pubs in Clapham", context: { foodNeeds: [amenity, "under£20 per person"] } },
        { query: "3 pubs in Clapham", context: { foodNeeds: ["under£20 per person", amenity] } },
      ] : []),
    ];
  })))("keeps venue serving predicates independent from route budgets: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), PLAN_GENERATION_TEST_NOW);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      const body = await response.json();
      const lacksSoftDrinkEvidence = !('context' in input) && input.query.includes("soft drinks");
      expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status }, JSON.stringify(body))
        .toEqual({ preparation: 200, post: lacksSoftDrinkEvidence ? 422 : 200 });
      if (!("prepared" in prepared)) throw new Error("Expected a pub route");
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      if (lacksSoftDrinkEvidence) {
        expect(body.code).toBe("GROUNDED_CONSTRAINTS_UNSATISFIED");
        expect(body.details.rejected.budgetEvidence).toBeGreaterThan(0);
      } else {
        expect(body.inferredContext.budgetLimitPence).toBe(2000);
        expect(body.stops).toHaveLength(3);
      }
    } finally {
      clock.mockRestore();
    }
  });
});
