import { describe, expect, it, vi } from "vitest";

import {
  chargedPaidLane,
  inferNightContext,
  installPlanGenerateRouteHooks,
  loadConciergeVenuesMock,
  PLAN_GENERATION_TEST_NOW,
  POST,
  preparePlanGeneration,
} from "./helpers/planGenerateRoute";

// POST /api/plans/generate: serving ownership after request words, decimal money,
// alcohol-free intent and unpriced drink and venue descriptions.
// The mocks, fixtures and hooks are shared in __tests__/helpers/planGenerateRoute.ts.
describe("POST /api/plans/generate", () => {
  installPlanGenerateRouteHooks();

  it.each(["I want", "please get", "we would like", "could you find", "get"].flatMap((request) => [
    ...["one serving weighing 200g under£10", "£10 for one serving weighing 200g"].map((phrase) => ({
      query: `One pub in Soho, ${request} ${phrase}`, context: { stopCount: 1 },
    })),
    ...[" and ", " plus ", "+", "&"].flatMap((join) => [
      `£10 pint at X${join}${request} a serving weighing 2g`,
      `pint at X${join}${request} a serving weighing 2g £10`,
    ]).flatMap((phrase) => [
      { query: `One pub in Soho, ${phrase}`, context: { stopCount: 1 } },
      ...(phrase.length <= 40 ? [{ query: "One pub in Soho", context: { stopCount: 1, foodNeeds: [phrase] } }] : []),
    ]),
  ]))("retains serving ownership after request introductions: %j", async (input) => {
    const request = () => new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    });
    const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
    const response = await POST(request());
    expect("response" in prepared ? await prepared.response.json() : null)
      .toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
    expect(chargedPaidLane()).toBe(false);
  });

  it.each([
    { query: "3 pubs in Clapham, 0.0 beer, maximum £5 per pint" },
    { query: "3 pubs in Clapham, alcohol-free beer, maximum £5 per pint" },
    { query: "3 pubs in Clapham", context: { zeroProof: true, foodNeeds: ["maximum £5 per pint"] } },
  ])("keeps alcohol-free controls separate from canonical pint scarcity: %j", async (input) => {
    const request = () => new Request("http://localhost/api/plans/generate", { method: "POST", body: JSON.stringify(input) });
    const prepared = await preparePlanGeneration(request(), Date.now());
    expect("response" in prepared ? await prepared.response.json() : null).toMatchObject({ code: "DRINK_PRICE_CONSTRAINTS_UNSUPPORTED" });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "DRINK_PRICE_CONSTRAINTS_UNSUPPORTED" });
  });

  it.each(["£20.00", "£20,00", "20.00 pounds", "20,00 quid"].flatMap((amount) => [
    { query: `3 pubs in Clapham, ${amount} per person, pints under£5` },
    { query: "3 pubs in Clapham", context: { foodNeeds: [`${amount} per person, pints under£5`] } },
  ]))("preserves decimal per-person totals beside pint caps: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const request = () => new Request("http://localhost/api/plans/generate", { method: "POST", body: JSON.stringify(input) });
      const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
      expect(prepared).toHaveProperty("prepared");
      if (!("prepared" in prepared)) throw new Error("Expected route budget preparation");
      expect(prepared.prepared.context).toMatchObject({ zeroProof: false, budgetLimitPence: 2000 });
      const response = await POST(request());
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.inferredContext).toMatchObject({ zeroProof: false, budgetLimitPence: 2000 });
      expect(body.budgetSummary).toMatchObject({ limitPence: 2000, withinLimit: true });
      for (const entry of body.stops.flatMap((stop: { alternatives: unknown[] }) => [stop, ...stop.alternatives])) {
        expect(entry.estimatedPintPricePence).toBeLessThanOrEqual(500);
      }
    } finally {
      clock.mockRestore();
    }
  });

  it.each(["0.01", "10.00", "20.00"].flatMap((amount) => [
    { query: `3 pubs in Clapham, maximum £${amount} per pint`, cap: Number(amount), total: null },
    { query: "3 pubs in Clapham", context: { foodNeeds: [`maximum £${amount} per pint`] }, cap: Number(amount), total: null },
    ...[false, true].map((reverse) => ({
      query: `3 pubs in Clapham, ${reverse ? "maximum £5 per pint, under £20.00 per person" : "under £20.00 per person, maximum £5 per pint"}`,
      cap: 5, total: 2000,
    })),
  ]))("keeps decimal currency out of alcohol-free intent: %j", async ({ cap, total, ...input }) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const request = () => new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      });
      expect(inferNightContext(input.query).context.zeroProof).toBe(false);
      const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
      expect(prepared).toHaveProperty("prepared");
      if (!("prepared" in prepared)) throw new Error("Expected canonical cap preparation");
      expect(prepared.prepared.context).toMatchObject({ zeroProof: false, budgetLimitPence: total });
      const response = await POST(request());
      const body = await response.json();
      if (cap < 1) {
        expect(response.status).toBe(422);
        expect(body).toMatchObject({ code: "GROUNDED_VENUES_INSUFFICIENT" });
      } else {
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.inferredContext).toMatchObject({ zeroProof: false, budgetLimitPence: total });
        for (const entry of body.stops.flatMap((stop: { alternatives: unknown[] }) => [stop, ...stop.alternatives])) {
          expect(entry.estimatedPintPricePence).toBeLessThanOrEqual(cap * 100);
          expect(entry.priceEvidence).toMatchObject({ pence: entry.estimatedPintPricePence });
        }
      }
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    ...["one warm serving weighing 200g", "one serving containing nuts", "a softly warmed generous serving containing nuts", "each warm serving weighing 2g", "2/3 warm servings containing nuts", "one warm serving that weighs 200g", "one serving that contains nuts", "a 0.5kg serving weighing 200g", "a 0,5kg serving weighing 200g"].flatMap((food) => [
      `${food} under£10`, `£10 for ${food}`,
      ...[" and ", " plus ", "+", "&"].flatMap((join) => [
        `£10 pint${join}${food}`, `pint${join}${food} £10`,
        ...["at", "in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((location) => [
          `£10 pint ${location} X${join}${food}`, `pint ${location} X${join}${food} £10`,
        ]),
      ]),
    ]),
    "£10 pint at X&a warm serving weighing 2g",
    "£10 pint at X&a serving that weighs 2g",
    "one serving containing nuts and under£10",
    ...["one serving pizza", "a serving chips"].flatMap((food) => [" and ", " plus ", "+", "&"].map((join) => `${food}${join}under£10`)),
  ].flatMap((phrase) => [
    ...[", ", " with ", " for "].map((introduction) => ({
      query: `One pub in Soho${introduction}${phrase}`, context: { stopCount: 1 },
    })),
    ...(phrase.length <= 40 ? [{ query: "One pub in Soho", context: { stopCount: 1, foodNeeds: [phrase] } }] : []),
  ]))("retains quantified serving ownership through arbitrary descriptors: %j", async (input) => {
    const request = () => new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    });
    const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
    const response = await POST(request());
    expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
      .toEqual({ preparation: 422, post: 422 });
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
    expect(chargedPaidLane()).toBe(false);
  });

  it.each(["sparkling beer", "sparkling wine", "steaming coffee"].flatMap((object) => [
    { query: `3 pubs in Soho, each serving ${object}, under£20 per person` },
    { query: "3 pubs in Soho", context: { foodNeeds: [`each serving ${object}, under£20`] } },
  ]))("keeps unpriced participial drink descriptions out of meal ownership: %j", async (input) => {
    const request = () => new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    });
    const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
    expect("prepared" in prepared).toBe(true);
    if (!("prepared" in prepared)) throw new Error("Expected a pub route");
    expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
    const response = await POST(request());
    const body = await response.json();
    if (response.status === 200) {
      expect(body.inferredContext.budgetLimitPence).toBe(2000);
      expect(body.stops).toHaveLength(3);
    } else {
      expect(response.status).toBe(422);
      expect(body.code).toBe("GROUNDED_CONSTRAINTS_UNSATISFIED");
      expect(body.details.rejected.budgetEvidence).toBeGreaterThan(0);
    }
  });

  it.each([
    ...["with a rooftop ", "with a garden ", "each "].flatMap((owner) => ["beer", "drinks", "pints"].map((object) => ({ owner, object }))),
    ...["food", "pizza", "beer and pizza"].map((object) => ({ owner: "pubs ", object })),
  ].flatMap(({ owner, object }) => [" and ", " plus ", "+", "&"].flatMap((join) => {
    const phrase = `${owner}serving ${object}${join}under£20`;
    return [
      { query: `3 pubs in Soho ${phrase} per person` },
      ...(phrase.length <= 40 ? [{ query: "3 pubs in Soho", context: { foodNeeds: [phrase] } }] : []),
    ];
  })))("separates coordinated venue drink predicates from route limits: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const request = () => new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      });
      const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
      const response = await POST(request());
      expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
        .toEqual({ preparation: 200, post: 200 });
      if (!("prepared" in prepared)) throw new Error("Expected a pub route");
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      expect(await response.json()).toMatchObject({ inferredContext: { budgetLimitPence: 2000 }, stops: expect.any(Array) });
    } finally {
      clock.mockRestore();
    }
  });

  it.each(["rooftop", "snug", "mezzanine", "courtyard"].flatMap((venue) => [
    { query: `3 pubs in Soho with a ${venue} serving beer, under£20` },
    { query: "3 pubs in Soho", context: { foodNeeds: [`with a ${venue} serving beer, under£20`] } },
    { query: "3 pubs in Soho", context: { foodNeeds: [`under£20, with a ${venue} serving beer`] } },
    { query: "3 pubs in Soho", context: { foodNeeds: [`with a ${venue} serving beer`, "pub route budget of£20"] } },
  ]))("keeps unpriced venue amenities independent from typed route totals: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const request = () => new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      });
      const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
      const response = await POST(request());
      expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
        .toEqual({ preparation: 200, post: 200 });
      if (!("prepared" in prepared)) throw new Error("Expected a pub route");
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      expect(await response.json()).toMatchObject({ inferredContext: { budgetLimitPence: 2000 }, stops: expect.any(Array) });
    } finally {
      clock.mockRestore();
    }
  });
});
