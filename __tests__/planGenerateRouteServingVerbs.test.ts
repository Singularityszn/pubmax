import { describe, expect, it, vi } from "vitest";

import {
  installPlanGenerateRouteHooks,
  PLAN_GENERATION_TEST_NOW,
  planPriceEvidenceForVenues,
  POST,
  preparePlanGeneration,
  priceEvidenceUsableForCeiling,
} from "./helpers/planGenerateRoute";

// POST /api/plans/generate: serving verbs and unpriced serving preferences stay
// separate from drink caps.
// The mocks, fixtures and hooks are shared in __tests__/helpers/planGenerateRoute.ts.
describe("POST /api/plans/generate", () => {
  installPlanGenerateRouteHooks();

  it.each([
    ...["beer", "drinks", "real ale", "mixed drinks and food", "craft beverages"].flatMap((object) => [
      "", "each ", "each regularly ", "with a garden ", "with a sunny terrace regularly ",
      "with a terrace and a garden ",
    ].flatMap((antecedent) => [
      `£5 pint ${antecedent}serving ${object}`, `pint under£5 ${antecedent}serving ${object}`,
      ...["at", "in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((location) => [
        `£5 pint ${location} X ${antecedent}serving ${object}`, `pint ${location} X under£5 ${antecedent}serving ${object}`,
      ]),
    ])),
    "£5 pint at pub serving pizza", "pint under£5 at pub serving pizza",
    "£5 pint serving pizza", "pint under£5 serving pizza",
    "pint under £ 5 serving pizza", "pint under5 pounds serving pizza", "pint under5 quid serving pizza",
    "£5 pint at pub serving hot pizza", "£5 pint at pub serving a pizza",
    "£5 pint at pub serving 2 pizzas", "£5 pint at pub serving food",
    "£5 pint at Beer and Burger serving pizza",
    "£5 pint at pub serves pizza", "£5 pint at pub with pizza",
    "£5 pint; a serving later", "£5 pint, servings afterwards",
    ...["to share", "for two", "for the table"].flatMap((modifier) => [
      `£5 pint serving pizza ${modifier}`, `£5 pint at X serving pizza ${modifier}`,
      `£5 pint; a serving ${modifier} later`,
    ]),
  ].flatMap((phrase) => [
    { query: `3 pubs in Clapham, ${phrase}, pub route budget of£20` },
    { query: `3 pubs in Clapham, pub route budget of£20, ${phrase}` },
    ...(phrase.length <= 40 ? [
      { query: "3 pubs in Clapham", context: { foodNeeds: [phrase, "pub route budget of£20"] } },
      { query: "3 pubs in Clapham", context: { foodNeeds: ["pub route budget of£20", phrase] } },
    ] : []),
  ]))("keeps serving verbs and unpriced serving preferences separate from drink caps: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), PLAN_GENERATION_TEST_NOW);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
        .toEqual({ preparation: 200, post: 200 });
      if (!("prepared" in prepared)) throw new Error("Expected a pub route");
      const body = await response.json();
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      expect(body.inferredContext.budgetLimitPence).toBe(2000);
      expect(body.stops).toHaveLength(3);
      const venues = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
      const evidence = await planPriceEvidenceForVenues(await venues.loadConciergeVenues("london"), PLAN_GENERATION_TEST_NOW);
      for (const { venue } of prepared.prepared.candidates) {
        const price = evidence.get(venue.id)!;
        expect(priceEvidenceUsableForCeiling(price)).toBe(true);
        expect(price.pence).toBeLessThanOrEqual(500);
      }
      for (const stop of body.stops) {
        for (const candidate of [stop, ...stop.alternatives]) {
          const price = evidence.get(candidate.venueId)!;
          expect(priceEvidenceUsableForCeiling(price)).toBe(true);
          expect(price.pence).toBeLessThanOrEqual(500);
          expect(candidate.estimatedPintPricePence).toBe(price.pence);
        }
      }
    } finally {
      clock.mockRestore();
    }
  });
});
